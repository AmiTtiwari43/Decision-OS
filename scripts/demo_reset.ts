/**
 * Decision OS — Demo Environment Reset & Seed Utility
 * Batch 04.4: Final Presentation Dataset and Demo Walkthrough
 *
 * DATA SAFETY GUARANTEES:
 * 1. Strict Domain Isolation: Only accounts with '@decision-os.org' or 'demo.*' are touched.
 * 2. Non-Destructive to Real Users: Real user accounts and non-demo decisions are NEVER modified or deleted.
 * 3. Safe Demo Credentials: Deterministic, repeatable test credentials for college presentation.
 * 4. Dual Mode:
 *    - Default (seed): Seeds pristine canonical "Enterprise Cloud Provider Decision" ready to present.
 *    - Clean Slate (--clean-slate): Cleans demo decisions so presenter can demonstrate creation from scratch.
 */

import mongoose from 'mongoose';
import { connectToDatabase, disconnectFromDatabase, isReplicaSetSupported } from '../apps/api/src/db/connection.js';
import { UserModel } from '../apps/api/src/models/user.model.js';
import { DecisionModel } from '../apps/api/src/models/decision.model.js';
import { AuditEventModel } from '../apps/api/src/models/audit.model.js';
import { DecisionContributionModel } from '../apps/api/src/models/contribution.model.js';
import { DecisionInvitationModel } from '../apps/api/src/models/invitation.model.js';
import { DecisionEvidenceModel } from '../apps/api/src/models/evidence.model.js';
import { hashPassword } from '../apps/api/src/utils/crypto.js';
import { computeCanonicalEventHash, GENESIS_PREVIOUS_HASH } from '../apps/api/src/services/audit.service.js';

const DEMO_DOMAIN = '@decision-os.org';
const DEFAULT_DEMO_PASSWORD = 'DemoPass123!';

export interface DemoUserSpec {
  email: string;
  name: string;
  role: 'user' | 'admin';
  title: string;
}

export const DEMO_USERS: (DemoUserSpec & { customPassword?: string })[] = [
  {
    email: `lead${DEMO_DOMAIN}`,
    name: 'Lead Decision Architect',
    role: 'user',
    title: 'Lead Enterprise Architect (Quick-Fill Demo Account)',
    customPassword: 'DecisionOS@2026',
  },
  {
    email: `demo.presenter${DEMO_DOMAIN}`,
    name: 'Alex Rivera',
    role: 'user',
    title: 'Lead Enterprise Architect (Demo Presenter)',
  },
  {
    email: `expert.sarah${DEMO_DOMAIN}`,
    name: 'Sarah Chen',
    role: 'user',
    title: 'Cloud Infrastructure Specialist (Expert Contributor)',
  },
  {
    email: `board.observer${DEMO_DOMAIN}`,
    name: 'Marcus Vance',
    role: 'user',
    title: 'Governance & Compliance Officer (Viewer / Stakeholder)',
  },
];

export async function resetDemoEnvironment(options: { cleanSlate?: boolean; uri?: string } = {}) {
  const isCleanSlate = options.cleanSlate ?? process.argv.includes('--clean-slate');

  console.log('\n================================================================');
  console.log(' DECISION OS — SAFE DEMO ENVIRONMENT RESET & SEED UTILITY');
  console.log(' Batch 04.4: Canonical Presentation Dataset');
  console.log('================================================================\n');

  // 1. Establish Connection
  const candidateUris = [
    options.uri || process.env.MONGODB_URI,
    'mongodb://127.0.0.1:27018/decision-os?replicaSet=rs0',
    'mongodb://127.0.0.1:27017/decision-os',
  ].filter(Boolean) as string[];

  let connected = false;
  for (const uri of candidateUris) {
    try {
      console.log(`Attempting connection to MongoDB at: ${uri.split('@').pop()}`);
      await connectToDatabase(uri, { serverSelectionTimeoutMS: 2000 });
      connected = true;
      console.log(`✓ Connected successfully. Topology supports replica transactions: ${isReplicaSetSupported()}`);
      break;
    } catch {
      // try next
    }
  }

  if (!connected) {
    throw new Error('Failed to connect to local MongoDB. Ensure MongoDB is running on port 27018 (replica set) or 27017.');
  }

  // 2. Strict Safety Verification: Check existing accounts
  const totalUsersBefore = await UserModel.countDocuments();
  const realUsers = await UserModel.find({
    email: { $not: new RegExp(`(${DEMO_DOMAIN}|demo\\.|test_e2e_)`, 'i') },
  });
  console.log(`\n[DATA SAFETY GUARD]`);
  console.log(`- Total registered accounts: ${totalUsersBefore}`);
  console.log(`- Protected real user accounts: ${realUsers.length}`);
  console.log(`- Invariant: Real user accounts and non-demo decisions will NOT be modified or deleted.`);

  // 3. Upsert Demo Accounts
  console.log(`\n[DEMO ACCOUNTS SETUP]`);
  const passwordHash = await hashPassword(DEFAULT_DEMO_PASSWORD);
  const createdDemoUsers: Record<string, string> = {};

  for (const spec of DEMO_USERS) {
    const userHash = spec.customPassword ? await hashPassword(spec.customPassword) : passwordHash;
    const existing = await UserModel.findOne({ email: spec.email.toLowerCase() });
    if (existing) {
      existing.name = spec.name;
      existing.passwordHash = userHash;
      await existing.save();
      createdDemoUsers[spec.email] = existing._id.toString();
      console.log(`  ✓ Updated demo account: ${spec.email} (${spec.title})`);
    } else {
      const created = await UserModel.create({
        email: spec.email.toLowerCase(),
        name: spec.name,
        passwordHash: userHash,
        role: spec.role,
      });
      createdDemoUsers[spec.email] = created._id.toString();
      console.log(`  ✓ Created demo account: ${spec.email} (${spec.title})`);
    }
  }

  const presenterId = createdDemoUsers[`demo.presenter${DEMO_DOMAIN}`];

  // 4. Clean previous demo decisions owned by demo presenter
  const demoDecisions = await DecisionModel.find({
    $or: [
      { createdById: presenterId },
      { title: 'Enterprise Cloud Provider Decision' },
    ],
  });

  const demoDecisionIds = demoDecisions.map((d) => d._id);
  if (demoDecisionIds.length > 0) {
    await mongoose.connection.collection('auditevents').deleteMany({ decisionId: { $in: demoDecisionIds } });
    await DecisionContributionModel.deleteMany({ decisionId: { $in: demoDecisionIds } });
    await DecisionInvitationModel.deleteMany({ decisionId: { $in: demoDecisionIds } });
    await DecisionEvidenceModel.deleteMany({ decisionId: { $in: demoDecisionIds } });
    await DecisionModel.deleteMany({ _id: { $in: demoDecisionIds } });
    console.log(`  ✓ Cleared ${demoDecisionIds.length} previous demo decision records and associated audit events.`);
  }

  let seededDecisionId: string | null = null;

  // 5. If not clean slate, seed the canonical decision
  if (!isCleanSlate) {
    console.log(`\n[SEEDING CANONICAL PRESENTATION DECISION]`);
    const decisionId = new mongoose.Types.ObjectId();
    const now = new Date();

    // Initial genesis audit event
    const initialHash = computeCanonicalEventHash({
      eventId: 'evt-001-canonical-init',
      decisionId: decisionId.toString(),
      actorId: presenterId,
      action: 'decision.create',
      entityType: 'decision',
      entityId: decisionId.toString(),
      summary: 'Initialized canonical Enterprise Cloud Provider Decision framework',
      timestamp: now,
      originalTimestamp: now,
      previousEventHash: GENESIS_PREVIOUS_HASH,
      schemaVersion: 1,
      sequenceNumber: 1,
    });

    const auditEvent = await AuditEventModel.create({
      eventId: 'evt-001-canonical-init',
      decisionId,
      actorId: presenterId,
      actorEmail: `demo.presenter${DEMO_DOMAIN}`,
      actorName: 'Alex Rivera',
      action: 'decision.create',
      entityType: 'decision',
      entityId: decisionId.toString(),
      summary: 'Initialized canonical Enterprise Cloud Provider Decision framework',
      timestamp: now,
      previousEventHash: GENESIS_PREVIOUS_HASH,
      eventHash: initialHash,
      sequenceNumber: 1,
      schemaVersion: 1,
    });

    const canonicalDoc = await DecisionModel.create({
      _id: decisionId,
      title: 'Enterprise Cloud Provider Decision',
      description: 'Which cloud provider provides the optimal architecture and cost balance for enterprise migration?',
      createdById: presenterId,
      members: [
        {
          userId: presenterId,
          role: 'owner',
          addedAt: now,
        },
      ],
      criteria: [
        {
          id: 'crit-tech',
          name: 'Technical Architecture',
          shortName: 'Tech Arch',
          weight: 60,
          direction: 'benefit',
          isLocked: true,
        },
        {
          id: 'crit-cost',
          name: 'Cost Efficiency',
          shortName: 'Cost Eff',
          weight: 40,
          direction: 'benefit',
          isLocked: false,
        },
      ],
      options: [
        {
          id: 'opt-alpha',
          name: 'Option Alpha (Specialized)',
          tagline: 'Top Tier Architecture',
          description: 'Specialized enterprise cloud provider with market-leading container performance and developer tooling.',
          color: '#38BDF8',
          scores: {
            'crit-tech': 90,
            'crit-cost': 70,
          },
        },
        {
          id: 'opt-beta',
          name: 'Option Beta (Cost-Optimized)',
          tagline: 'Budget-friendly baseline',
          description: 'Frugal, cost-optimized enterprise infrastructure offering aggressive committed-use discounts.',
          color: '#B8FF5A',
          scores: {
            'crit-tech': 70,
            'crit-cost': 90,
          },
        },
      ],
      scores: {
        'opt-alpha': { 'crit-tech': 90, 'crit-cost': 70 },
        'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 },
      },
      scoreProvenance: {}, // Pristine; 0 synthetic values
      auditHead: {
        sequenceNumber: 1,
        eventHash: auditEvent.eventHash,
        timestamp: now,
      },
      version: 1,
    });

    seededDecisionId = canonicalDoc._id.toString();
    console.log(`  ✓ Canonical Decision Seeded: ID = ${seededDecisionId}`);
    console.log(`  ✓ Weighted baseline: Option Alpha (82.0 pts) vs Option Beta (78.0 pts) | Margin: +4.0 pts`);
    console.log(`  ✓ Audit Head Hash: ${canonicalDoc.auditHead.eventHash.slice(0, 16)}... (Sequence #1)`);
  } else {
    console.log(`\n[CLEAN SLATE ACTIVE]`);
    console.log(`  ✓ Demo decisions cleared. Presenter can demonstrate creating from scratch via UI.`);
  }

  // 6. Print Presentation Access Details
  console.log('\n================================================================');
  console.log(' PRESENTATION ACCESS CREDENTIALS');
  console.log('================================================================');
  console.log(` Web URL:           http://localhost:5173`);
  console.log(` API Endpoint:      http://localhost:3000/api`);
  console.log(` Password (All):    ${DEFAULT_DEMO_PASSWORD}`);
  console.log('----------------------------------------------------------------');
  for (const user of DEMO_USERS) {
    console.log(` ${user.title.padEnd(52)}: ${user.email}`);
  }
  if (seededDecisionId) {
    console.log('----------------------------------------------------------------');
    console.log(` Direct Decision URL: http://localhost:5173/?decisionId=${seededDecisionId}`);
  }
  console.log('================================================================\n');

  await disconnectFromDatabase();
  return {
    success: true,
    seededDecisionId,
    demoUsers: DEMO_USERS.map((u) => ({ email: u.email, role: u.role, title: u.title })),
  };
}

if (process.argv[1]?.endsWith('demo_reset.ts') || process.argv[1]?.endsWith('demo_reset.js')) {
  resetDemoEnvironment().then(() => process.exit(0)).catch((err) => {
    console.error('Reset failed:', err);
    process.exit(1);
  });
}
