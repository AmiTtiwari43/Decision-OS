/**
 * Decision OS — Comprehensive Vast Mock Seed Data Generator
 *
 * Populates ALL MongoDB collections with authentic, realistic enterprise decision intelligence records:
 * - users: 7 diverse enterprise roles with safe demo credentials
 * - decisions: 4 deep decisions across Cloud, AI, Lakehouse, and Microservices
 * - decision_evidence: 14 empirical benchmarks, whitepapers, Gartner reports, and SOC2 audits
 * - decisioncontributions: 12 submitted multi-criteria expert contributions
 * - decisionaccessgrants: 10 role-based access grants (editor, viewer, contributor)
 * - decisioninvitations: 10 pending and accepted team invitations
 * - comments: 14 threaded review discussions and collaborative feedback
 * - decision_disagreements: 10 tracked consensus disagreements and resolutions
 * - expert_predictions: 10 testable outcome predictions with Brier calibration scores
 * - decisionsnapshots: 10 historical milestone and locked-round snapshots
 * - auditevents: 24 cryptographically chained SHA-256 tamper-evident audit logs
 * - operation_journal: 10 idempotent committed transaction records
 * - notificationoutboxes: 10 distributed notification records
 * - notificationconsumerrecords: 10 completed idempotent consumer records
 */

import { randomUUID, createHash } from 'node:crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: 'apps/api/.env' });

import { connectToDatabase, disconnectFromDatabase, isReplicaSetSupported } from '../apps/api/src/db/connection.js';
import { UserModel } from '../apps/api/src/models/user.model.js';
import { DecisionModel } from '../apps/api/src/models/decision.model.js';
import { AuditEventModel } from '../apps/api/src/models/audit.model.js';
import { DecisionContributionModel } from '../apps/api/src/models/contribution.model.js';
import { DecisionInvitationModel } from '../apps/api/src/models/invitation.model.js';
import { DecisionEvidenceModel } from '../apps/api/src/models/evidence.model.js';
import { DecisionAccessGrantModel } from '../apps/api/src/models/decisionAccess.model.js';
import { CommentModel } from '../apps/api/src/models/comment.model.js';
import { DisagreementResolutionModel } from '../apps/api/src/models/disagreement.model.js';
import { ExpertPredictionModel } from '../apps/api/src/models/prediction.model.js';
import { DecisionSnapshotModel } from '../apps/api/src/models/snapshot.model.js';
import { OperationJournalModel } from '../apps/api/src/models/operationJournal.model.js';
import { NotificationOutboxModel, NotificationConsumerRecordModel } from '../apps/api/src/models/outbox.model.js';
import { hashPassword } from '../apps/api/src/utils/crypto.js';
import { computeCanonicalEventHash, GENESIS_PREVIOUS_HASH } from '../apps/api/src/services/audit.service.js';
import { evaluateDecision } from '../packages/decision-engine/src/index.js';

const DEMO_DOMAIN = '@decision-os.org';
const DEFAULT_PASSWORD = 'DecisionOS@2026';
const FALLBACK_PASSWORD = 'DemoPass123!';

export const VAST_DEMO_USERS = [
  {
    email: `lead${DEMO_DOMAIN}`,
    name: 'Lead Decision Architect',
    role: 'admin' as const,
    title: 'Lead Enterprise Architect & Decision System Admin',
  },
  {
    email: `demo.presenter${DEMO_DOMAIN}`,
    name: 'Alex Rivera',
    role: 'user' as const,
    title: 'Principal Enterprise Architect & Presentation Lead',
  },
  {
    email: `expert.sarah${DEMO_DOMAIN}`,
    name: 'Sarah Chen',
    role: 'user' as const,
    title: 'Principal Cloud & Distributed Systems Specialist',
  },
  {
    email: `board.observer${DEMO_DOMAIN}`,
    name: 'Marcus Vance',
    role: 'user' as const,
    title: 'Governance, Risk & Compliance Officer',
  },
  {
    email: `analyst.rachel${DEMO_DOMAIN}`,
    name: 'Rachel Kim',
    role: 'user' as const,
    title: 'Senior Quantitative Analyst & FinOps Lead',
  },
  {
    email: `vp.security${DEMO_DOMAIN}`,
    name: 'Vikram Patel',
    role: 'user' as const,
    title: 'VP of Information Security & CISO Advisor',
  },
  {
    email: `finance.dave${DEMO_DOMAIN}`,
    name: 'Dave Miller',
    role: 'user' as const,
    title: 'Director of Financial Planning & Infrastructure Budgets',
  },
];

export async function seedVastDatabase(options: { uri?: string } = {}) {
  console.log('\n================================================================');
  console.log(' DECISION OS — VAST ENTERPRISE MOCK SEED GENERATOR');
  console.log(' Populating 100% of MongoDB Collections with Authentic Data');
  console.log('================================================================\n');

  const uri = options.uri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os';
  console.log(`Connecting to MongoDB cluster: ${uri.split('@').pop()}`);
  await connectToDatabase(uri, { serverSelectionTimeoutMS: 8000 });
  console.log(`✓ Connected. Topology replica transactions supported: ${isReplicaSetSupported()}`);

  // 1. Upsert Users
  console.log(`\n[1/12] Upserting ${VAST_DEMO_USERS.length} Demo Users...`);
  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  const userMap: Record<string, any> = {};

  for (const spec of VAST_DEMO_USERS) {
    let user = await UserModel.findOne({ email: spec.email.toLowerCase() });
    if (!user) {
      user = await UserModel.create({
        email: spec.email.toLowerCase(),
        name: spec.name,
        role: spec.role,
        passwordHash,
      });
      console.log(`  ✓ Created user: ${spec.email} (${spec.name})`);
    } else {
      user.name = spec.name;
      user.role = spec.role;
      user.passwordHash = passwordHash;
      await user.save();
      console.log(`  ✓ Updated user: ${spec.email} (${spec.name})`);
    }
    userMap[spec.email] = user;
  }

  const leadUser = userMap[`lead${DEMO_DOMAIN}`];
  const presenterUser = userMap[`demo.presenter${DEMO_DOMAIN}`];
  const sarahUser = userMap[`expert.sarah${DEMO_DOMAIN}`];
  const marcusUser = userMap[`board.observer${DEMO_DOMAIN}`];
  const rachelUser = userMap[`analyst.rachel${DEMO_DOMAIN}`];
  const vikramUser = userMap[`vp.security${DEMO_DOMAIN}`];
  const daveUser = userMap[`finance.dave${DEMO_DOMAIN}`];

  // 2. Define 4 Rich Decisions
  console.log(`\n[2/12] Defining 4 Master Decisions...`);

  const decisionsData = [
    {
      _id: new mongoose.Types.ObjectId('6b0403c15dc64526b11c9fe8'), // Canonical Presentation Decision
      title: 'Enterprise Cloud Provider Decision',
      description: 'Which hyperscaler cloud provider delivers the optimal technical elasticity, latency SLAs, security certifications, and committed-use cost balance for the global core platform migration?',
      ownerId: leadUser._id,
      criteria: [
        { id: 'crit-tech', name: 'Technical Architecture & Performance', shortName: 'Tech Arch', weight: 40, direction: 'benefit' as const, isLocked: true },
        { id: 'crit-cost', name: 'Cost Efficiency & FinOps Agility', shortName: 'FinOps Cost', weight: 35, direction: 'benefit' as const, isLocked: false },
        { id: 'crit-sec', name: 'Security, Compliance & Multi-Region SLAs', shortName: 'Sec & SLAs', weight: 25, direction: 'benefit' as const, isLocked: false },
      ],
      options: [
        {
          id: 'opt-alpha',
          name: 'Option Alpha (AWS Cloud Platform)',
          tagline: 'Market Leader in Ecosystem Depth',
          description: 'Global compute footprint with ultra-mature container orchestration (EKS), comprehensive IAM controls, and extensive enterprise partner ecosystem.',
          color: '#38BDF8',
        },
        {
          id: 'opt-beta',
          name: 'Option Beta (Google Cloud Platform)',
          tagline: 'Kubernetes Pioneer & Data Powerhouse',
          description: 'Native Kubernetes (GKE) excellence, private global software-defined fiber network, and industry-leading analytical BigQuery integration.',
          color: '#B8FF5A',
        },
        {
          id: 'opt-gamma',
          name: 'Option Gamma (Microsoft Azure)',
          tagline: 'Enterprise Identity & Hybrid Alignment',
          description: 'Deep Microsoft Active Directory federation, hybrid cloud enterprise agreements, and integrated AI cognitive service infrastructure.',
          color: '#F59E0B',
        },
      ],
      scores: {
        'opt-alpha': { 'crit-tech': 92, 'crit-cost': 74, 'crit-sec': 94 },
        'opt-beta': { 'crit-tech': 95, 'crit-cost': 88, 'crit-sec': 89 },
        'opt-gamma': { 'crit-tech': 86, 'crit-cost': 82, 'crit-sec': 91 },
      },
    },
    {
      _id: new mongoose.Types.ObjectId('6b0403c15dc64526b11c9fe9'),
      title: 'Primary Enterprise LLM & AI Gateway Selection',
      description: 'Selecting our primary foundation model provider and gateway topology for enterprise conversational intelligence, automated code synthesis, and customer-facing workflows.',
      ownerId: presenterUser._id,
      criteria: [
        { id: 'crit-reasoning', name: 'Multi-Step Complex Reasoning & Accuracy', shortName: 'Reasoning', weight: 35, direction: 'benefit' as const, isLocked: false },
        { id: 'crit-latency', name: 'P90 First-Token Latency (TTFT) & Streaming', shortName: 'TTFT Latency', weight: 25, direction: 'benefit' as const, isLocked: false },
        { id: 'crit-pricing', name: 'Blended Cost per 1M Input/Output Tokens', shortName: 'Token Pricing', weight: 20, direction: 'benefit' as const, isLocked: false },
        { id: 'crit-privacy', name: 'Enterprise Data Privacy & Zero-Retention', shortName: 'Data Privacy', weight: 20, direction: 'benefit' as const, isLocked: true },
      ],
      options: [
        {
          id: 'opt-claude',
          name: 'Anthropic Claude 3.5 Sonnet',
          tagline: 'State-of-the-Art Code & Logic',
          description: 'Best-in-class code generation, nuanced instruction adherence, and industry-leading alignment safety benchmarks.',
          color: '#FB7185',
        },
        {
          id: 'opt-gpt4o',
          name: 'OpenAI GPT-4o Omni',
          tagline: 'Omni-Modal Speed & Broad Tooling',
          description: 'High token streaming throughput, wide JSON schema validation support, and mature fine-tuning APIs.',
          color: '#34D399',
        },
        {
          id: 'opt-gemini',
          name: 'Google Gemini 2.5 Flash / Pro',
          tagline: 'Ultra-Fast 1M+ Context Window',
          description: 'Massive million-token context capabilities, native multimodal processing, and cost-effective batch pricing.',
          color: '#A78BFA',
        },
      ],
      scores: {
        'opt-claude': { 'crit-reasoning': 96, 'crit-latency': 84, 'crit-pricing': 78, 'crit-privacy': 95 },
        'opt-gpt4o': { 'crit-reasoning': 91, 'crit-latency': 92, 'crit-pricing': 82, 'crit-privacy': 88 },
        'opt-gemini': { 'crit-reasoning': 88, 'crit-latency': 96, 'crit-pricing': 94, 'crit-privacy': 89 },
      },
    },
    {
      _id: new mongoose.Types.ObjectId('6b0403c15dc64526b11c9fea'),
      title: 'Next-Gen Analytical Lakehouse Platform',
      description: 'Architecting our modern cloud data warehouse and open lakehouse platform to consolidate batch pipelines, ad-hoc BI analytics, and real-time streaming ML features.',
      ownerId: rachelUser._id,
      criteria: [
        { id: 'crit-concurrency', name: 'P95 Query Latency at High Concurrency', shortName: 'Concurrency', weight: 30, direction: 'benefit' as const, isLocked: false },
        { id: 'crit-open-table', name: 'Open Table Standards (Apache Iceberg)', shortName: 'Open Iceberg', weight: 30, direction: 'benefit' as const, isLocked: true },
        { id: 'crit-tco', name: '3-Year Total Cost of Ownership (TCO)', shortName: '3-Year TCO', weight: 25, direction: 'benefit' as const, isLocked: false },
        { id: 'crit-governance', name: 'Row/Column Access Governance & Lineage', shortName: 'Data Lineage', weight: 15, direction: 'benefit' as const, isLocked: false },
      ],
      options: [
        {
          id: 'opt-snowflake',
          name: 'Snowflake Cortex Data Cloud',
          tagline: 'Zero-Ops Elastic Warehousing',
          description: 'Near-zero maintenance, instant compute scaling, separation of storage/compute, and native data marketplace sharing.',
          color: '#38BDF8',
        },
        {
          id: 'opt-databricks',
          name: 'Databricks Unity Lakehouse',
          tagline: 'Unified Apache Spark & Delta Engine',
          description: 'End-to-end data engineering and ML governance platform with open Lakehouse formats and Unity Catalog.',
          color: '#F472B6',
        },
        {
          id: 'opt-bigquery',
          name: 'Google BigQuery & BigLake',
          tagline: 'Serverless Multi-Cloud Analytics',
          description: 'Completely serverless SQL analytics engine with federated multi-cloud BigLake object store querying.',
          color: '#B8FF5A',
        },
      ],
      scores: {
        'opt-snowflake': { 'crit-concurrency': 94, 'crit-open-table': 78, 'crit-tco': 72, 'crit-governance': 96 },
        'opt-databricks': { 'crit-concurrency': 88, 'crit-open-table': 97, 'crit-tco': 86, 'crit-governance': 91 },
        'opt-bigquery': { 'crit-concurrency': 91, 'crit-open-table': 87, 'crit-tco': 90, 'crit-governance': 92 },
      },
    },
    {
      _id: new mongoose.Types.ObjectId('6b0403c15dc64526b11c9feb'),
      title: 'Core Payment Microservices Runtime & Language',
      description: 'Selecting the standardized programming language and microservices framework for the tier-1 ledger and high-throughput financial settlement engine.',
      ownerId: leadUser._id,
      criteria: [
        { id: 'crit-perf', name: 'P99 Latency & Tail Variance Under Load', shortName: 'P99 Latency', weight: 35, direction: 'benefit' as const, isLocked: true },
        { id: 'crit-velocity', name: 'Engineering Velocity & Onboarding Speed', shortName: 'Dev Velocity', weight: 30, direction: 'benefit' as const, isLocked: false },
        { id: 'crit-memory', name: 'Memory Footprint & CPU Efficiency', shortName: 'Resource Eff', weight: 20, direction: 'benefit' as const, isLocked: false },
        { id: 'crit-ecosystem', name: 'Enterprise Observability & Library Ecosystem', shortName: 'Ecosystem', weight: 15, direction: 'benefit' as const, isLocked: false },
      ],
      options: [
        {
          id: 'opt-rust',
          name: 'Rust (Axum & Tokio Runtime)',
          tagline: 'Zero-Cost Abstractions & Memory Safety',
          description: 'Uncompromising performance with compile-time memory safety, zero garbage collection pauses, and minimal memory footprint.',
          color: '#FB7185',
        },
        {
          id: 'opt-go',
          name: 'Go (Fiber / Standard net/http)',
          tagline: 'Simplicity, Concurrency & Fast Builds',
          description: 'High-performance concurrent goroutines, rapid compile cycles, simple syntax, and lightweight deployment binaries.',
          color: '#34D399',
        },
        {
          id: 'opt-node',
          name: 'Node.js / TypeScript (Fastify)',
          tagline: 'Universal Language & Massive Ecosystem',
          description: 'Single-language full-stack developer productivity, async I/O event loop, and vast npm package ecosystem.',
          color: '#F59E0B',
        },
      ],
      scores: {
        'opt-rust': { 'crit-perf': 98, 'crit-velocity': 68, 'crit-memory': 98, 'crit-ecosystem': 79 },
        'opt-go': { 'crit-perf': 91, 'crit-velocity': 89, 'crit-memory': 87, 'crit-ecosystem': 92 },
        'opt-node': { 'crit-perf': 82, 'crit-velocity': 96, 'crit-memory': 72, 'crit-ecosystem': 96 },
      },
    },
  ];

  // Clean demo decisions and dependent documents
  const allDecisionIds = decisionsData.map(d => d._id);
  console.log(`Clearing old records for ${allDecisionIds.length} target decisions...`);
  await DecisionModel.deleteMany({ _id: { $in: allDecisionIds } });
  if (mongoose.connection.db) {
    await mongoose.connection.collection('auditevents').deleteMany({ decisionId: { $in: allDecisionIds } });
  }
  await DecisionEvidenceModel.deleteMany({ decisionId: { $in: allDecisionIds } });
  await DecisionContributionModel.deleteMany({ decisionId: { $in: allDecisionIds } });
  await DecisionAccessGrantModel.deleteMany({ decisionId: { $in: allDecisionIds } });
  await DecisionInvitationModel.deleteMany({ decisionId: { $in: allDecisionIds } });
  await CommentModel.deleteMany({ decisionId: { $in: allDecisionIds } });
  await DisagreementResolutionModel.deleteMany({ decisionId: { $in: allDecisionIds } });
  await ExpertPredictionModel.deleteMany({ decisionId: { $in: allDecisionIds } });
  if (mongoose.connection.db) {
    await mongoose.connection.collection('decisionsnapshots').deleteMany({ decisionId: { $in: allDecisionIds } });
  }
  await OperationJournalModel.deleteMany({ decisionId: { $in: allDecisionIds } });
  await NotificationOutboxModel.deleteMany({ decisionId: { $in: allDecisionIds } });
  await NotificationConsumerRecordModel.deleteMany({});

  // 3. Insert Decisions and Compute Canonical MCDA Analyses
  for (const d of decisionsData) {
    const engineResult = evaluateDecision({
      criteria: d.criteria.map(c => ({ id: c.id, name: c.name, weight: c.weight, direction: c.direction, isLocked: c.isLocked })),
      options: d.options.map(o => ({ id: o.id, name: o.name, scores: d.scores[o.id] || {} })),
      scores: d.scores,
    });

    const now = new Date(Date.now() - 7 * 86400000); // Created 7 days ago
    const genesisEventId = randomUUID();

    const genesisHash = computeCanonicalEventHash({
      eventId: genesisEventId,
      decisionId: d._id.toString(),
      actorId: d.ownerId.toString(),
      action: 'decision.create',
      entityType: 'decision',
      entityId: d._id.toString(),
      summary: `Initialized ${d.title}`,
      timestamp: now,
      originalTimestamp: now,
      previousEventHash: GENESIS_PREVIOUS_HASH,
      schemaVersion: 1,
      sequenceNumber: 1,
    });

    await AuditEventModel.create({
      eventId: genesisEventId,
      decisionId: d._id,
      actorId: d.ownerId.toString(),
      actorEmail: d.ownerId.toString() === leadUser._id.toString() ? leadUser.email : (d.ownerId.toString() === presenterUser._id.toString() ? presenterUser.email : rachelUser.email),
      actorName: d.ownerId.toString() === leadUser._id.toString() ? leadUser.name : (d.ownerId.toString() === presenterUser._id.toString() ? presenterUser.name : rachelUser.name),
      action: 'decision.create',
      entityType: 'decision',
      entityId: d._id.toString(),
      summary: `Initialized ${d.title}`,
      timestamp: now,
      originalTimestamp: now,
      previousEventHash: GENESIS_PREVIOUS_HASH,
      eventHash: genesisHash,
      sequenceNumber: 1,
      schemaVersion: 1,
    });

    await DecisionModel.create({
      ...d,
      analysis: engineResult,
      calculationVersion: 1,
      version: 1,
      scoreProvenance: {},
      isAudited: true,
      auditIntegrityStatus: 'healthy',
      auditHead: {
        sequenceNumber: 1,
        eventHash: genesisHash,
        lastEventId: genesisEventId,
        updatedAt: now,
      },
    });
    const winnerScore = engineResult.evaluations[0]?.weightedScore ?? 0;
    console.log(`  ✓ Seeded Decision: "${d.title}" (Winner: ${engineResult.winnerId}, Score: ${winnerScore.toFixed(1)} pts)`);
  }

  // 4. Seed Decision Evidence (14 total, 3-4 per decision)
  console.log(`\n[3/12] Seeding 14 Authentic Empirical Evidence Records...`);
  const evidenceSeeds = [
    // Decision 1: Cloud Provider
    {
      decisionId: decisionsData[0]._id,
      targetType: 'option' as const,
      targetId: 'opt-alpha',
      createdById: sarahUser._id,
      type: 'url' as const,
      title: 'AWS Enterprise Global Infrastructure & SLA Whitepaper (2025/2026)',
      sourceUrl: 'https://aws.amazon.com/compliance/uptime-slas/',
      sourceExcerpt: 'Multi-AZ architecture commitments offer a 99.99% availability SLA for Amazon EC2 and EKS clusters spanning 34 geographic regions.',
      userSummary: 'Validates Tier-1 compute availability and extensive global disaster recovery failover regions.',
      publicationDate: new Date('2025-12-15'),
      provenance: { createdByName: sarahUser.name, createdByEmail: sarahUser.email, capturedVia: 'web_link' as const },
    },
    {
      decisionId: decisionsData[0]._id,
      targetType: 'option' as const,
      targetId: 'opt-beta',
      createdById: rachelUser._id,
      type: 'document' as const,
      title: 'Google Cloud FinOps Committed-Use Discount (CUD) Audit Benchmark',
      documentReference: 'FINOPS-AUDIT-Q4-2025-GCP.pdf',
      sourceExcerpt: 'Resource-based CUDs across BigQuery and GKE produce an aggregate 41.2% spend reduction compared to on-demand pricing across 3-year commitment plans.',
      userSummary: 'FinOps comparative study demonstrating superior discount flexibility without rigid instance locking.',
      publicationDate: new Date('2026-01-20'),
      provenance: { createdByName: rachelUser.name, createdByEmail: rachelUser.email, capturedVia: 'document_citation' as const },
    },
    {
      decisionId: decisionsData[0]._id,
      targetType: 'criterion' as const,
      targetId: 'crit-sec',
      createdById: vikramUser._id,
      type: 'excerpt' as const,
      title: 'SOC 2 Type II and FedRAMP High Compliance Matrix Comparison',
      sourceExcerpt: 'All three evaluated cloud providers maintain active ISO/IEC 27001:2022, SOC 2 Type II, and PCI-DSS Level 1 certifications across all target regions.',
      userSummary: 'Confirmed zero compliance blockers across AWS, GCP, and Azure for regulated payment workloads.',
      publicationDate: new Date('2026-02-10'),
      provenance: { createdByName: vikramUser.name, createdByEmail: vikramUser.email, capturedVia: 'manual_entry' as const },
    },
    {
      decisionId: decisionsData[0]._id,
      targetType: 'decision' as const,
      targetId: decisionsData[0]._id.toString(),
      createdById: leadUser._id,
      type: 'url' as const,
      title: 'Gartner Magic Quadrant for Strategic Cloud Platform Services',
      sourceUrl: 'https://www.gartner.com/en/documents/strategic-cloud-platforms-2025',
      sourceExcerpt: 'AWS and Google Cloud maintain the highest execution velocity and completeness of vision in enterprise container management and AI integration.',
      userSummary: 'Third-party analyst report confirming market leadership positioning.',
      publicationDate: new Date('2025-11-01'),
      provenance: { createdByName: leadUser.name, createdByEmail: leadUser.email, capturedVia: 'web_link' as const },
    },

    // Decision 2: LLM Gateway
    {
      decisionId: decisionsData[1]._id,
      targetType: 'option' as const,
      targetId: 'opt-claude',
      createdById: presenterUser._id,
      type: 'url' as const,
      title: 'SWE-bench Verified & HumanEval Multi-Language Coding Leaderboard',
      sourceUrl: 'https://swebench.com/verified-leaderboard',
      sourceExcerpt: 'Claude 3.5 Sonnet scored 49.2% on SWE-bench Verified, outperforming competitive models in resolving real GitHub repository pull requests and bug fixes.',
      userSummary: 'Rigorous empirical evaluation confirming superior reasoning and refactoring precision.',
      publicationDate: new Date('2026-01-10'),
      provenance: { createdByName: presenterUser.name, createdByEmail: presenterUser.email, capturedVia: 'web_link' as const },
    },
    {
      decisionId: decisionsData[1]._id,
      targetType: 'criterion' as const,
      targetId: 'crit-latency',
      createdById: sarahUser._id,
      type: 'document' as const,
      title: 'Internal API Gateway Streaming TTFT Latency Test (10,000 requests)',
      documentReference: 'INTERNAL-AI-GATEWAY-BENCH-2026.pdf',
      sourceExcerpt: 'Gemini 2.5 achieved a P90 TTFT of 240ms, GPT-4o achieved 310ms, and Claude 3.5 Sonnet recorded 450ms across streaming JSON completions.',
      userSummary: 'Gemini Flash provides unbeatable raw response streaming velocity for real-time interactive widgets.',
      publicationDate: new Date('2026-02-14'),
      provenance: { createdByName: sarahUser.name, createdByEmail: sarahUser.email, capturedVia: 'document_citation' as const },
    },
    {
      decisionId: decisionsData[1]._id,
      targetType: 'criterion' as const,
      targetId: 'crit-privacy',
      createdById: vikramUser._id,
      type: 'excerpt' as const,
      title: 'Enterprise Zero-Data Retention (ZDR) Legal Agreement Terms',
      sourceExcerpt: 'Anthropic Commercial Terms and Azure OpenAI Service both guarantee zero persistent customer data logging or training on submitted customer prompts.',
      userSummary: 'Legal compliance prerequisite satisfied for both Anthropic Commercial and Enterprise OpenAI.',
      publicationDate: new Date('2026-01-25'),
      provenance: { createdByName: vikramUser.name, createdByEmail: vikramUser.email, capturedVia: 'manual_entry' as const },
    },

    // Decision 3: Lakehouse Platform
    {
      decisionId: decisionsData[2]._id,
      targetType: 'option' as const,
      targetId: 'opt-databricks',
      createdById: rachelUser._id,
      type: 'url' as const,
      title: 'Apache Iceberg & Delta Lake UniForm Benchmark on TPC-DS 10TB',
      sourceUrl: 'https://blog.databricks.com/uniform-iceberg-benchmarks',
      sourceExcerpt: 'Unity Catalog UniForm enables Delta tables to be read natively as Apache Iceberg with zero data duplication and sub-second metadata synchronization.',
      userSummary: 'Directly validates our requirement to avoid vendor lock-in with open table formats.',
      publicationDate: new Date('2026-01-30'),
      provenance: { createdByName: rachelUser.name, createdByEmail: rachelUser.email, capturedVia: 'web_link' as const },
    },
    {
      decisionId: decisionsData[2]._id,
      targetType: 'option' as const,
      targetId: 'opt-snowflake',
      createdById: daveUser._id,
      type: 'document' as const,
      title: 'Snowflake Cortex & Multi-Cluster Auto-Scaling Cost Model',
      documentReference: 'FINOPS-SNOWFLAKE-3YR-ESTIMATE.xlsx',
      sourceExcerpt: 'Multi-cluster automatic suspend and resume reduces idle compute costs, though storage ingress/egress fees require dedicated cost guardrails.',
      userSummary: 'Financial assessment showing strong performance with need for credit quota monitoring.',
      publicationDate: new Date('2026-02-05'),
      provenance: { createdByName: daveUser.name, createdByEmail: daveUser.email, capturedVia: 'document_citation' as const },
    },
    {
      decisionId: decisionsData[2]._id,
      targetType: 'criterion' as const,
      targetId: 'crit-governance',
      createdById: marcusUser._id,
      type: 'excerpt' as const,
      title: 'GDPR & HIPAA Data Lineage & Column-Level Tagging Audit',
      sourceExcerpt: 'Both Snowflake Object Tagging and Databricks Unity Catalog passed independent ISO 27701 privacy audit requirements with automated PII masking.',
      userSummary: 'Meets internal regulatory standards for automated column-level PII data redacting.',
      publicationDate: new Date('2026-02-12'),
      provenance: { createdByName: marcusUser.name, createdByEmail: marcusUser.email, capturedVia: 'manual_entry' as const },
    },

    // Decision 4: Microservices Runtime
    {
      decisionId: decisionsData[3]._id,
      targetType: 'option' as const,
      targetId: 'opt-rust',
      createdById: sarahUser._id,
      type: 'url' as const,
      title: 'TechEmpower Framework Benchmarks Round 22 (JSON Serialization & DB)',
      sourceUrl: 'https://www.techempower.com/benchmarks/#section=data-r22',
      sourceExcerpt: 'Rust with Axum and Tokio achieved 1,850,000 req/sec with P99 tail latency under 1.2ms, requiring 94% less RAM than equivalent v8 runtime processes.',
      userSummary: 'Definitive performance benchmark proving Rust supremacy for ultra-low latency transaction paths.',
      publicationDate: new Date('2025-10-18'),
      provenance: { createdByName: sarahUser.name, createdByEmail: sarahUser.email, capturedVia: 'web_link' as const },
    },
    {
      decisionId: decisionsData[3]._id,
      targetType: 'option' as const,
      targetId: 'opt-go',
      createdById: leadUser._id,
      type: 'document' as const,
      title: 'Engineering Team Onboarding & Time-to-Production Velocity Study',
      documentReference: 'DEV-ONBOARDING-EXPERIMENT-2025.pdf',
      sourceExcerpt: 'Engineers without prior Go experience shipped production microservices within 11 days, compared to 38 days for engineers learning Rust.',
      userSummary: 'Crucial developer velocity evidence highlighting Go maintainability and team scaling advantages.',
      publicationDate: new Date('2026-01-14'),
      provenance: { createdByName: leadUser.name, createdByEmail: leadUser.email, capturedVia: 'document_citation' as const },
    },
    {
      decisionId: decisionsData[3]._id,
      targetType: 'criterion' as const,
      targetId: 'crit-ecosystem',
      createdById: presenterUser._id,
      type: 'excerpt' as const,
      title: 'OpenTelemetry & Prometheus Native SDK Maturity Evaluation',
      sourceExcerpt: 'Node.js and Go possess mature auto-instrumentation SDKs for OpenTelemetry with zero manual span boilerplate, whereas Rust requires explicit span tracing wrappers.',
      userSummary: 'Observability ecosystem maturity comparison across APM and distributed tracing.',
      publicationDate: new Date('2026-02-02'),
      provenance: { createdByName: presenterUser.name, createdByEmail: presenterUser.email, capturedVia: 'manual_entry' as const },
    },
    {
      decisionId: decisionsData[3]._id,
      targetType: 'decision' as const,
      targetId: decisionsData[3]._id.toString(),
      createdById: vikramUser._id,
      type: 'url' as const,
      title: 'White House ONCD Report on Memory Safe Programming Languages',
      sourceUrl: 'https://www.whitehouse.gov/oncd/briefing-room/2024/02/26/memory-safety/',
      sourceExcerpt: 'National cybersecurity policy recommends rapid migration to memory-safe languages (Rust, Go) to eliminate buffer overflow vulnerabilities in critical infrastructure.',
      userSummary: 'Strategic regulatory compliance alignment backing memory safety.',
      publicationDate: new Date('2024-02-26'),
      provenance: { createdByName: vikramUser.name, createdByEmail: vikramUser.email, capturedVia: 'web_link' as const },
    },
  ];

  await DecisionEvidenceModel.insertMany(evidenceSeeds);
  console.log(`  ✓ Inserted ${evidenceSeeds.length} evidence records.`);

  // 5. Seed Expert Contributions (12 total, 3 per decision)
  console.log(`\n[4/12] Seeding 12 Submitted Multi-Criteria Expert Contributions...`);
  const contributionSeeds = [
    // Decision 1: Cloud
    {
      decisionId: decisionsData[0]._id,
      contributorId: sarahUser._id,
      recommendation: {
        preferredOptionId: 'opt-beta',
        rationale: 'Google Cloud provides superior Kubernetes cluster autoscaling responsiveness and native BigQuery integration. GKE nodes spin up in under 45 seconds compared to 120 seconds on EKS.',
      },
      criterionScores: { 'crit-tech': 95, 'crit-cost': 88, 'crit-sec': 90 },
      criterionReasoning: {
        'crit-tech': 'GKE node provisioning and VPC native networking are best-in-class for containerized workloads.',
        'crit-cost': 'Sustained use discounts apply automatically without committing to strict instance shapes upfront.',
        'crit-sec': 'Shielded VMs and Titan security chips provide robust hardware-rooted root-of-trust.',
      },
      confidence: 0.92,
      prediction: {
        statement: 'Google Cloud deployment will achieve lower monthly egress spend than AWS for multi-region APIs.',
        targetDate: new Date('2026-08-31'),
        probability: 0.85,
      },
      evidenceReferences: ['Google Cloud FinOps Committed-Use Discount (CUD) Audit Benchmark'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 4 * 86400000),
    },
    {
      decisionId: decisionsData[0]._id,
      contributorId: vikramUser._id,
      recommendation: {
        preferredOptionId: 'opt-alpha',
        rationale: 'AWS IAM permission boundaries and KMS multi-region key replication have the most battle-tested security track record across global financial enterprises.',
      },
      criterionScores: { 'crit-tech': 91, 'crit-cost': 75, 'crit-sec': 96 },
      criterionReasoning: {
        'crit-tech': 'Vast breadth of managed services reduces the need for self-hosted operational clusters.',
        'crit-cost': 'Reserved instances require high upfront capital planning, which increases FinOps overhead.',
        'crit-sec': 'Unrivaled compliance certifications and automated AWS GuardDuty anomaly detection.',
      },
      confidence: 0.88,
      prediction: {
        statement: 'AWS will pass all external SOC2 Type II audits with 0 non-conformities during annual recertification.',
        targetDate: new Date('2026-10-15'),
        probability: 0.95,
      },
      evidenceReferences: ['SOC 2 Type II and FedRAMP High Compliance Matrix Comparison'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 3 * 86400000),
    },
    {
      decisionId: decisionsData[0]._id,
      contributorId: daveUser._id,
      recommendation: {
        preferredOptionId: 'opt-beta',
        rationale: 'FinOps modeling indicates GCP offers the most transparent billing API and flexible committed-use discounts across all evaluated tiers.',
      },
      criterionScores: { 'crit-tech': 89, 'crit-cost': 92, 'crit-sec': 88 },
      criterionReasoning: {
        'crit-tech': 'Meets all fundamental operational requirements.',
        'crit-cost': 'Sustained-use discounts save an estimated $140,000 annually without rigid instance lock-in.',
        'crit-sec': 'Adequate for our tier-2 and tier-1 PCI compliance specifications.',
      },
      confidence: 0.85,
      prediction: {
        statement: '3-year TCO on Google Cloud will be at least 12% lower than AWS baseline.',
        targetDate: new Date('2026-12-31'),
        probability: 0.80,
      },
      evidenceReferences: ['Google Cloud FinOps Committed-Use Discount (CUD) Audit Benchmark'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 2 * 86400000),
    },

    // Decision 2: LLM Gateway
    {
      decisionId: decisionsData[1]._id,
      contributorId: presenterUser._id,
      recommendation: {
        preferredOptionId: 'opt-claude',
        rationale: 'Claude 3.5 Sonnet demonstrates markedly fewer hallucinations in synthetic data transformation and multi-turn architectural reasoning.',
      },
      criterionScores: { 'crit-reasoning': 97, 'crit-latency': 85, 'crit-pricing': 78, 'crit-privacy': 95 },
      criterionReasoning: {
        'crit-reasoning': 'Consistently tops our internal SQL and TypeScript synthesis eval benchmarks.',
        'crit-latency': 'Reasonable streaming TTFT, highly consistent pacing without stalling.',
        'crit-pricing': 'Competitive pricing, well worth the premium given the 15% reduction in retry tokens.',
        'crit-privacy': 'Zero-data retention agreement explicitly documented.',
      },
      confidence: 0.94,
      prediction: {
        statement: 'Claude 3.5 Sonnet will achieve >90% first-pass accuracy on the production agent eval suite.',
        targetDate: new Date('2026-06-30'),
        probability: 0.90,
      },
      evidenceReferences: ['SWE-bench Verified & HumanEval Multi-Language Coding Leaderboard'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 4 * 86400000),
    },
    {
      decisionId: decisionsData[1]._id,
      contributorId: sarahUser._id,
      recommendation: {
        preferredOptionId: 'opt-gemini',
        rationale: 'For customer-facing interactive widgets, sub-second latency is non-negotiable. Gemini Flash provides 240ms TTFT with massive context headroom.',
      },
      criterionScores: { 'crit-reasoning': 88, 'crit-latency': 97, 'crit-pricing': 95, 'crit-privacy': 89 },
      criterionReasoning: {
        'crit-reasoning': 'Very good for standard classification, extraction, and summarization tasks.',
        'crit-latency': 'Fastest first token arrival time across all tested providers.',
        'crit-pricing': 'Extremely economical for high-volume background jobs.',
        'crit-privacy': 'Enterprise GCP privacy agreement covers the Vertex endpoint.',
      },
      confidence: 0.90,
      prediction: {
        statement: 'Streaming chat widgets powered by Gemini Flash will sustain <300ms median TTFT under peak load.',
        targetDate: new Date('2026-07-31'),
        probability: 0.92,
      },
      evidenceReferences: ['Internal API Gateway Streaming TTFT Latency Test (10,000 requests)'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 3 * 86400000),
    },
    {
      decisionId: decisionsData[1]._id,
      contributorId: vikramUser._id,
      recommendation: {
        preferredOptionId: 'opt-claude',
        rationale: 'Anthropic commercial terms and prompt injection defense benchmarks provide the highest assurance for handling sensitive corporate workflows.',
      },
      criterionScores: { 'crit-reasoning': 95, 'crit-latency': 82, 'crit-pricing': 80, 'crit-privacy': 96 },
      criterionReasoning: {
        'crit-reasoning': 'Strong compliance with system prompts and jailbreak resistance.',
        'crit-latency': 'Acceptable for asynchronous and analyst-assist workflows.',
        'crit-pricing': 'Fair enterprise volume commitment discounts.',
        'crit-privacy': 'No customer data utilized for model fine-tuning or post-training.',
      },
      confidence: 0.89,
      prediction: {
        statement: 'No prompt injection leaks will occur in external red-team testing of Claude gateway.',
        targetDate: new Date('2026-09-30'),
        probability: 0.88,
      },
      evidenceReferences: ['Enterprise Zero-Data Retention (ZDR) Legal Agreement Terms'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 2 * 86400000),
    },

    // Decision 3: Lakehouse
    {
      decisionId: decisionsData[2]._id,
      contributorId: rachelUser._id,
      recommendation: {
        preferredOptionId: 'opt-databricks',
        rationale: 'Databricks Unity Catalog UniForm allows writing once and querying seamlessly via both Delta Lake and Apache Iceberg readers.',
      },
      criterionScores: { 'crit-concurrency': 89, 'crit-open-table': 98, 'crit-tco': 86, 'crit-governance': 92 },
      criterionReasoning: {
        'crit-concurrency': 'Serverless SQL warehouses spin up in 5 seconds and scale linearly.',
        'crit-open-table': 'UniForm technology eliminates data lock-in and vendor storage trapping.',
        'crit-tco': 'Predictable DBU pricing with automated idle compute shutdown.',
        'crit-governance': 'Unity Catalog provides unified cross-cloud lineage and automated tagging.',
      },
      confidence: 0.92,
      prediction: {
        statement: 'Databricks UniForm tables will read without performance penalty in external Apache Iceberg query engines.',
        targetDate: new Date('2026-08-15'),
        probability: 0.90,
      },
      evidenceReferences: ['Apache Iceberg & Delta Lake UniForm Benchmark on TPC-DS 10TB'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 5 * 86400000),
    },
    {
      decisionId: decisionsData[2]._id,
      contributorId: leadUser._id,
      recommendation: {
        preferredOptionId: 'opt-snowflake',
        rationale: 'Snowflake requires virtually zero DBA maintenance and offers the fastest cold-start query performance for business analysts and executive dashboards.',
      },
      criterionScores: { 'crit-concurrency': 95, 'crit-open-table': 80, 'crit-tco': 75, 'crit-governance': 96 },
      criterionReasoning: {
        'crit-concurrency': 'Unrivaled multi-cluster elasticity with zero query queueing.',
        'crit-open-table': 'Iceberg tables are supported but second-class compared to native micro-partitions.',
        'crit-tco': 'High flexibility but requires active FinOps monitoring to avoid runaway warehouse credits.',
        'crit-governance': 'Impeccable tag-based masking and row-level access policies.',
      },
      confidence: 0.86,
      prediction: {
        statement: 'Snowflake will maintain P95 dashboard query latency <800ms across 200 concurrent users.',
        targetDate: new Date('2026-11-30'),
        probability: 0.92,
      },
      evidenceReferences: ['Snowflake Cortex & Multi-Cluster Auto-Scaling Cost Model'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 4 * 86400000),
    },
    {
      decisionId: decisionsData[2]._id,
      contributorId: marcusUser._id,
      recommendation: {
        preferredOptionId: 'opt-bigquery',
        rationale: 'BigQuery serverless slot commitments offer predictable annual expenditure and automatic integration with Google Cloud IAM.',
      },
      criterionScores: { 'crit-concurrency': 91, 'crit-open-table': 88, 'crit-tco': 92, 'crit-governance': 93 },
      criterionReasoning: {
        'crit-concurrency': 'Slot autoscaling handles spiky analytical workloads smoothly.',
        'crit-open-table': 'BigLake support for Iceberg and Parquet in Cloud Storage is solid.',
        'crit-tco': 'Editions flat-rate slot reservations offer the best budget predictability.',
        'crit-governance': 'Native Cloud DLP integration for automated sensitive data inspection.',
      },
      confidence: 0.88,
      prediction: {
        statement: 'BigQuery annual spend will remain within 5% of forecasted budget allocation.',
        targetDate: new Date('2026-12-31'),
        probability: 0.85,
      },
      evidenceReferences: ['GDPR & HIPAA Data Lineage & Column-Level Tagging Audit'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 3 * 86400000),
    },

    // Decision 4: Microservices Runtime
    {
      decisionId: decisionsData[3]._id,
      contributorId: sarahUser._id,
      recommendation: {
        preferredOptionId: 'opt-rust',
        rationale: 'For tier-1 financial settlement, a single garbage collection pause can cause transaction timeouts. Rust provides deterministic sub-millisecond execution.',
      },
      criterionScores: { 'crit-perf': 99, 'crit-velocity': 69, 'crit-memory': 99, 'crit-ecosystem': 80 },
      criterionReasoning: {
        'crit-perf': 'P99 tail latency is rock solid at 1.1ms under 50,000 req/sec load.',
        'crit-velocity': 'Steeper learning curve, but compiler enforces thread safety and eliminates null pointers.',
        'crit-memory': 'Container memory footprint is under 25MB per replica.',
        'crit-ecosystem': 'Tokio and Axum have reached rock-solid 1.0 maturity.',
      },
      confidence: 0.95,
      prediction: {
        statement: 'Rust microservice will run 90 consecutive days without a single memory leak or OOM restart.',
        targetDate: new Date('2026-09-15'),
        probability: 0.98,
      },
      evidenceReferences: ['TechEmpower Framework Benchmarks Round 22 (JSON Serialization & DB)'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 4 * 86400000),
    },
    {
      decisionId: decisionsData[3]._id,
      contributorId: leadUser._id,
      recommendation: {
        preferredOptionId: 'opt-go',
        rationale: 'Go provides 90% of Rust performance while enabling our entire engineering organization to contribute without a 6-month ramp-up penalty.',
      },
      criterionScores: { 'crit-perf': 92, 'crit-velocity': 90, 'crit-memory': 88, 'crit-ecosystem': 93 },
      criterionReasoning: {
        'crit-perf': 'Go 1.24 GC pause times are under 100 microseconds, perfectly fine for payment SLAs.',
        'crit-velocity': 'Engineers become productive within 2 weeks; code reviews are concise and straightforward.',
        'crit-memory': 'Modest 45MB RAM footprint per pod.',
        'crit-ecosystem': 'Exceptional enterprise tooling, standard library, and OpenTelemetry instrumentation.',
      },
      confidence: 0.91,
      prediction: {
        statement: 'Engineering team will deliver the core ledger API in Go 4 weeks ahead of estimated Rust timeline.',
        targetDate: new Date('2026-07-15'),
        probability: 0.88,
      },
      evidenceReferences: ['Engineering Team Onboarding & Time-to-Production Velocity Study'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 3 * 86400000),
    },
    {
      decisionId: decisionsData[3]._id,
      contributorId: presenterUser._id,
      recommendation: {
        preferredOptionId: 'opt-go',
        rationale: 'Go hits the exact sweet spot between low runtime overhead and fast engineering delivery for our microservices roadmap.',
      },
      criterionScores: { 'crit-perf': 90, 'crit-velocity': 88, 'crit-memory': 86, 'crit-ecosystem': 91 },
      criterionReasoning: {
        'crit-perf': 'Proven at scale across Kubernetes and Docker ecosystems.',
        'crit-velocity': 'Simple concurrency model with goroutines and channels.',
        'crit-memory': 'Fast startup times make it ideal for auto-scaling serverless containers.',
        'crit-ecosystem': 'Superb gRPC and protocol buffer compilation pipeline.',
      },
      confidence: 0.89,
      prediction: {
        statement: 'Microservices written in Go will sustain P99 latency <5ms at 25,000 requests/sec.',
        targetDate: new Date('2026-08-30'),
        probability: 0.90,
      },
      evidenceReferences: ['OpenTelemetry & Prometheus Native SDK Maturity Evaluation'],
      status: 'submitted' as const,
      revision: 1,
      submittedAt: new Date(Date.now() - 2 * 86400000),
    },
  ];

  await DecisionContributionModel.insertMany(contributionSeeds);
  console.log(`  ✓ Inserted ${contributionSeeds.length} expert contribution records.`);

  // 6. Seed Decision Access Grants (10 total, 2-3 per decision)
  console.log(`\n[5/12] Seeding 10 Decision Access Grants...`);
  const accessGrantSeeds = [
    // Decision 1: Cloud
    { decisionId: decisionsData[0]._id, userId: sarahUser._id, role: 'contributor' as const, grantedBy: leadUser._id },
    { decisionId: decisionsData[0]._id, userId: vikramUser._id, role: 'editor' as const, grantedBy: leadUser._id },
    { decisionId: decisionsData[0]._id, userId: marcusUser._id, role: 'viewer' as const, grantedBy: leadUser._id },

    // Decision 2: LLM Gateway
    { decisionId: decisionsData[1]._id, userId: leadUser._id, role: 'editor' as const, grantedBy: presenterUser._id },
    { decisionId: decisionsData[1]._id, userId: sarahUser._id, role: 'contributor' as const, grantedBy: presenterUser._id },
    { decisionId: decisionsData[1]._id, userId: vikramUser._id, role: 'editor' as const, grantedBy: presenterUser._id },

    // Decision 3: Lakehouse
    { decisionId: decisionsData[2]._id, userId: leadUser._id, role: 'editor' as const, grantedBy: rachelUser._id },
    { decisionId: decisionsData[2]._id, userId: daveUser._id, role: 'contributor' as const, grantedBy: rachelUser._id },

    // Decision 4: Microservices
    { decisionId: decisionsData[3]._id, userId: sarahUser._id, role: 'editor' as const, grantedBy: leadUser._id },
    { decisionId: decisionsData[3]._id, userId: presenterUser._id, role: 'contributor' as const, grantedBy: leadUser._id },
  ];

  await DecisionAccessGrantModel.insertMany(accessGrantSeeds);
  console.log(`  ✓ Inserted ${accessGrantSeeds.length} decision access grants.`);

  // 7. Seed Decision Invitations (10 total, 2-3 per decision)
  console.log(`\n[6/12] Seeding 10 Decision Invitations...`);
  const invitationSeeds = [
    // Decision 1
    {
      decisionId: decisionsData[0]._id,
      inviterId: leadUser._id,
      email: 'external.auditor@kpmg-audit.com',
      role: 'viewer' as const,
      tokenHash: createHash('sha256').update('kpmg-audit-token-2026').digest('hex'),
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 14 * 86400000),
    },
    {
      decisionId: decisionsData[0]._id,
      inviterId: leadUser._id,
      email: sarahUser.email,
      role: 'contributor' as const,
      tokenHash: createHash('sha256').update('sarah-invite-token-cloud').digest('hex'),
      status: 'accepted' as const,
      expiresAt: new Date(Date.now() + 14 * 86400000),
      acceptedAt: new Date(Date.now() - 5 * 86400000),
      acceptedBy: sarahUser._id,
    },

    // Decision 2
    {
      decisionId: decisionsData[1]._id,
      inviterId: presenterUser._id,
      email: 'ml.researcher@stanford-ai.org',
      role: 'contributor' as const,
      tokenHash: createHash('sha256').update('stanford-ai-token-2026').digest('hex'),
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 10 * 86400000),
    },
    {
      decisionId: decisionsData[1]._id,
      inviterId: presenterUser._id,
      email: vikramUser.email,
      role: 'editor' as const,
      tokenHash: createHash('sha256').update('vikram-ai-invite-token').digest('hex'),
      status: 'accepted' as const,
      expiresAt: new Date(Date.now() + 14 * 86400000),
      acceptedAt: new Date(Date.now() - 4 * 86400000),
      acceptedBy: vikramUser._id,
    },

    // Decision 3
    {
      decisionId: decisionsData[2]._id,
      inviterId: rachelUser._id,
      email: 'finops.consultant@cloudcosts.io',
      role: 'viewer' as const,
      tokenHash: createHash('sha256').update('finops-consultant-token').digest('hex'),
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 7 * 86400000),
    },
    {
      decisionId: decisionsData[2]._id,
      inviterId: rachelUser._id,
      email: daveUser.email,
      role: 'contributor' as const,
      tokenHash: createHash('sha256').update('dave-lakehouse-invite-token').digest('hex'),
      status: 'accepted' as const,
      expiresAt: new Date(Date.now() + 14 * 86400000),
      acceptedAt: new Date(Date.now() - 6 * 86400000),
      acceptedBy: daveUser._id,
    },

    // Decision 4
    {
      decisionId: decisionsData[3]._id,
      inviterId: leadUser._id,
      email: 'performance.specialist@systems-lab.com',
      role: 'contributor' as const,
      tokenHash: createHash('sha256').update('systems-lab-token-2026').digest('hex'),
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 12 * 86400000),
    },
    {
      decisionId: decisionsData[3]._id,
      inviterId: leadUser._id,
      email: presenterUser.email,
      role: 'contributor' as const,
      tokenHash: createHash('sha256').update('presenter-microservices-token').digest('hex'),
      status: 'accepted' as const,
      expiresAt: new Date(Date.now() + 14 * 86400000),
      acceptedAt: new Date(Date.now() - 5 * 86400000),
      acceptedBy: presenterUser._id,
    },
    {
      decisionId: decisionsData[0]._id,
      inviterId: leadUser._id,
      email: 'dave.miller.finops@external-partner.org',
      role: 'viewer' as const,
      tokenHash: createHash('sha256').update('partner-token-cloud-rev').digest('hex'),
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 20 * 86400000),
    },
    {
      decisionId: decisionsData[1]._id,
      inviterId: presenterUser._id,
      email: 'security.advisor@infosec-review.org',
      role: 'viewer' as const,
      tokenHash: createHash('sha256').update('infosec-ai-review-token').digest('hex'),
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 18 * 86400000),
    },
  ];

  await DecisionInvitationModel.insertMany(invitationSeeds);
  console.log(`  ✓ Inserted ${invitationSeeds.length} decision invitations.`);

  // 8. Seed Comments (14 total, 3-4 per decision)
  console.log(`\n[7/12] Seeding 14 Collaborative Discussion Comments...`);
  const commentSeeds = [
    // Decision 1: Cloud
    {
      decisionId: decisionsData[0]._id,
      authorId: sarahUser._id.toString(),
      authorName: sarahUser.name,
      authorRole: 'contributor' as const,
      targetType: 'criterion' as const,
      targetId: 'crit-tech',
      content: 'Regarding Technical Architecture: We completed testing GKE vs EKS cross-region latency. GKE VPC-native routing shaved 14ms off our inter-service gRPC calls.',
      isResolved: false,
      replyCount: 1,
      createdAt: new Date(Date.now() - 4 * 86400000),
    },
    {
      decisionId: decisionsData[0]._id,
      authorId: leadUser._id.toString(),
      authorName: leadUser.name,
      authorRole: 'owner' as const,
      targetType: 'criterion' as const,
      targetId: 'crit-tech',
      content: 'That 14ms reduction is substantial for our payment settlement pipeline. Did the test include Istio service mesh mTLS overhead?',
      isResolved: false,
      replyCount: 0,
      createdAt: new Date(Date.now() - 3 * 86400000),
    },
    {
      decisionId: decisionsData[0]._id,
      authorId: vikramUser._id.toString(),
      authorName: vikramUser.name,
      authorRole: 'editor' as const,
      targetType: 'option' as const,
      targetId: 'opt-alpha',
      content: 'AWS IAM policy evaluation logic is strictly auditable with AWS Access Analyzer. That gives our compliance committee high confidence.',
      isResolved: true,
      resolvedBy: { id: leadUser._id.toString(), name: leadUser.name },
      resolvedAt: new Date(Date.now() - 1 * 86400000),
      replyCount: 0,
      createdAt: new Date(Date.now() - 2 * 86400000),
    },

    // Decision 2: LLM Gateway
    {
      decisionId: decisionsData[1]._id,
      authorId: presenterUser._id.toString(),
      authorName: presenterUser.name,
      authorRole: 'owner' as const,
      targetType: 'decision' as const,
      targetId: decisionsData[1]._id.toString(),
      content: 'We need to make sure our gateway supports automatic failover between Anthropic and OpenAI in case of upstream 429 rate limit errors.',
      isResolved: false,
      replyCount: 1,
      createdAt: new Date(Date.now() - 3 * 86400000),
    },
    {
      decisionId: decisionsData[1]._id,
      authorId: sarahUser._id.toString(),
      authorName: sarahUser.name,
      authorRole: 'contributor' as const,
      targetType: 'decision' as const,
      targetId: decisionsData[1]._id.toString(),
      content: 'Implemented! The FailoverAIProvider handles circuit-breaking and automatically switches upstream providers in under 500ms.',
      isResolved: true,
      resolvedBy: { id: presenterUser._id.toString(), name: presenterUser.name },
      resolvedAt: new Date(Date.now() - 1 * 86400000),
      replyCount: 0,
      createdAt: new Date(Date.now() - 2 * 86400000),
    },
    {
      decisionId: decisionsData[1]._id,
      authorId: vikramUser._id.toString(),
      authorName: vikramUser.name,
      authorRole: 'editor' as const,
      targetType: 'criterion' as const,
      targetId: 'crit-privacy',
      content: 'Please confirm that zero-retention is verified via written Enterprise BAA before customer PII is routed through the gateway.',
      isResolved: false,
      replyCount: 0,
      createdAt: new Date(Date.now() - 1 * 86400000),
    },

    // Decision 3: Lakehouse
    {
      decisionId: decisionsData[2]._id,
      authorId: rachelUser._id.toString(),
      authorName: rachelUser.name,
      authorRole: 'owner' as const,
      targetType: 'option' as const,
      targetId: 'opt-databricks',
      content: 'Databricks UniForm means our Apache Iceberg readers in BigQuery can directly query Databricks Delta tables without copying terabytes of data.',
      isResolved: false,
      replyCount: 0,
      createdAt: new Date(Date.now() - 4 * 86400000),
    },
    {
      decisionId: decisionsData[2]._id,
      authorId: daveUser._id.toString(),
      authorName: daveUser.name,
      authorRole: 'contributor' as const,
      targetType: 'criterion' as const,
      targetId: 'crit-tco',
      content: 'Snowflake credit consumption in the proof-of-concept spiked during heavy transform hours. I recommend setting up auto-suspend timers at 60 seconds.',
      isResolved: true,
      resolvedBy: { id: rachelUser._id.toString(), name: rachelUser.name },
      resolvedAt: new Date(Date.now() - 2 * 86400000),
      replyCount: 0,
      createdAt: new Date(Date.now() - 3 * 86400000),
    },
    {
      decisionId: decisionsData[2]._id,
      authorId: marcusUser._id.toString(),
      authorName: marcusUser.name,
      authorRole: 'viewer' as const,
      targetType: 'criterion' as const,
      targetId: 'crit-governance',
      content: 'Audit logging for row-level masking in Unity Catalog has passed internal compliance inspection with flying colors.',
      isResolved: false,
      replyCount: 0,
      createdAt: new Date(Date.now() - 1 * 86400000),
    },

    // Decision 4: Microservices
    {
      decisionId: decisionsData[3]._id,
      authorId: sarahUser._id.toString(),
      authorName: sarahUser.name,
      authorRole: 'editor' as const,
      targetType: 'option' as const,
      targetId: 'opt-rust',
      content: 'Our load tests with Rust Axum achieved 120,000 transactions per second on an 8-core c7g instance with 0 garbage collection pauses.',
      isResolved: false,
      replyCount: 1,
      createdAt: new Date(Date.now() - 3 * 86400000),
    },
    {
      decisionId: decisionsData[3]._id,
      authorId: leadUser._id.toString(),
      authorName: leadUser.name,
      authorRole: 'owner' as const,
      targetType: 'criterion' as const,
      targetId: 'crit-velocity',
      content: 'While Rust latency is unmatched, we have 45 backend developers to train. Go allows 80% of the team to ship code within sprint 1.',
      isResolved: false,
      replyCount: 0,
      createdAt: new Date(Date.now() - 2 * 86400000),
    },
    {
      decisionId: decisionsData[3]._id,
      authorId: presenterUser._id.toString(),
      authorName: presenterUser.name,
      authorRole: 'contributor' as const,
      targetType: 'decision' as const,
      targetId: decisionsData[3]._id.toString(),
      content: 'A hybrid pattern where Go powers 90% of business microservices and Rust handles the crypto hashing engine could be our ideal compromise.',
      isResolved: false,
      replyCount: 0,
      createdAt: new Date(Date.now() - 1 * 86400000),
    },
    {
      decisionId: decisionsData[0]._id,
      authorId: rachelUser._id.toString(),
      authorName: rachelUser.name,
      authorRole: 'viewer' as const,
      targetType: 'criterion' as const,
      targetId: 'crit-cost',
      content: 'FinOps team has updated the 3-year commitment discount calculator in the evidence repository.',
      isResolved: false,
      replyCount: 0,
      createdAt: new Date(Date.now() - 1 * 86400000),
    },
    {
      decisionId: decisionsData[1]._id,
      authorId: leadUser._id.toString(),
      authorName: leadUser.name,
      authorRole: 'editor' as const,
      targetType: 'option' as const,
      targetId: 'opt-gemini',
      content: 'Gemini 2.5 Flash pricing at $0.075 / 1M input tokens makes bulk document indexing 10x cheaper than competitors.',
      isResolved: false,
      replyCount: 0,
      createdAt: new Date(Date.now() - 1 * 86400000),
    },
  ];

  await CommentModel.insertMany(commentSeeds);
  console.log(`  ✓ Inserted ${commentSeeds.length} collaborative review comments.`);

  // 9. Seed Disagreement Resolutions (10 total, 2-3 per decision)
  console.log(`\n[8/12] Seeding 10 Tracked Consensus Disagreements & Resolutions...`);
  const disagreementSeeds = [
    // Decision 1
    {
      decisionId: decisionsData[0]._id,
      disagreementId: 'disagree-cloud-tech-vs-cost',
      category: 'priority' as const,
      criterionId: 'crit-cost',
      optionId: 'opt-alpha',
      status: 'resolved' as const,
      resolutionExplanation: 'Reconciled during Architectural Review Board on Feb 12: Locked Technical Architecture at 40% and Cost Efficiency at 35% with unanimous consent.',
      resolvedById: leadUser._id,
      resolvedByName: leadUser.name,
      resolvedAt: new Date(Date.now() - 2 * 86400000),
    },
    {
      decisionId: decisionsData[0]._id,
      disagreementId: 'disagree-cloud-sec-weight',
      category: 'score' as const,
      criterionId: 'crit-sec',
      optionId: 'opt-beta',
      status: 'acknowledged' as const,
      resolutionExplanation: 'Vikram Patel requested raising GCP security score from 85 to 89 following review of Titan security chip whitepaper.',
      resolvedById: vikramUser._id,
      resolvedByName: vikramUser.name,
      resolvedAt: new Date(Date.now() - 1 * 86400000),
    },

    // Decision 2
    {
      decisionId: decisionsData[1]._id,
      disagreementId: 'disagree-llm-latency-importance',
      category: 'priority' as const,
      criterionId: 'crit-latency',
      optionId: 'opt-gemini',
      status: 'resolved' as const,
      resolutionExplanation: 'Agreed to prioritize complex reasoning at 35% and latency at 25%, establishing that quality takes precedence over sub-200ms TTFT for analytics.',
      resolvedById: presenterUser._id,
      resolvedByName: presenterUser.name,
      resolvedAt: new Date(Date.now() - 1 * 86400000),
    },
    {
      decisionId: decisionsData[1]._id,
      disagreementId: 'disagree-claude-pricing-impact',
      category: 'assumption' as const,
      criterionId: 'crit-pricing',
      optionId: 'opt-claude',
      status: 'open' as const,
      resolutionExplanation: 'Open debate on whether prompt caching reduces Sonnet net monthly invoice by 50% in production workloads.',
    },

    // Decision 3
    {
      decisionId: decisionsData[2]._id,
      disagreementId: 'disagree-iceberg-lockin-risk',
      category: 'evidence' as const,
      criterionId: 'crit-open-table',
      optionId: 'opt-snowflake',
      status: 'resolved' as const,
      resolutionExplanation: 'Confirmed with Snowflake engineering that Polaris Catalog integration provides full open-source Apache Iceberg catalog compatibility.',
      resolvedById: rachelUser._id,
      resolvedByName: rachelUser.name,
      resolvedAt: new Date(Date.now() - 2 * 86400000),
    },
    {
      decisionId: decisionsData[2]._id,
      disagreementId: 'disagree-databricks-concurrency',
      category: 'score' as const,
      criterionId: 'crit-concurrency',
      optionId: 'opt-databricks',
      status: 'acknowledged' as const,
      resolutionExplanation: 'Sarah Chen noted that Serverless SQL Warehouses close the concurrency gap previously seen on classic clusters.',
    },

    // Decision 4
    {
      decisionId: decisionsData[3]._id,
      disagreementId: 'disagree-rust-ramp-up-timeline',
      category: 'assumption' as const,
      criterionId: 'crit-velocity',
      optionId: 'opt-rust',
      status: 'resolved' as const,
      resolutionExplanation: 'Consensus reached: We will proceed with Go as the primary microservice baseline, using Rust FFI bindings for performance-critical crypto modules.',
      resolvedById: leadUser._id,
      resolvedByName: leadUser.name,
      resolvedAt: new Date(Date.now() - 1 * 86400000),
    },
    {
      decisionId: decisionsData[3]._id,
      disagreementId: 'disagree-node-memory-overhead',
      category: 'score' as const,
      criterionId: 'crit-memory',
      optionId: 'opt-node',
      status: 'acknowledged' as const,
      resolutionExplanation: 'Fastify v5 reduces per-socket heap allocations, but V8 isolate baseline still exceeds 60MB per instance.',
    },
    {
      decisionId: decisionsData[0]._id,
      disagreementId: 'disagree-azure-hybrid-fit',
      category: 'interpretation' as const,
      criterionId: 'crit-tech',
      optionId: 'opt-gamma',
      status: 'open' as const,
      resolutionExplanation: 'Evaluating whether existing enterprise E5 licensing justifies Azure compute adoption.',
    },
    {
      decisionId: decisionsData[1]._id,
      disagreementId: 'disagree-gpt4o-json-schema-reliability',
      category: 'evidence' as const,
      criterionId: 'crit-reasoning',
      optionId: 'opt-gpt4o',
      status: 'resolved' as const,
      resolutionExplanation: 'Structured Outputs guarantee 100% schema compliance, resolved with proof-of-concept test suite.',
      resolvedById: presenterUser._id,
      resolvedByName: presenterUser.name,
      resolvedAt: new Date(Date.now() - 1 * 86400000),
    },
  ];

  await DisagreementResolutionModel.insertMany(disagreementSeeds);
  console.log(`  ✓ Inserted ${disagreementSeeds.length} consensus disagreement resolution records.`);

  // 10. Seed Expert Predictions & Calibration Outcomes (10 total)
  console.log(`\n[9/12] Seeding 10 Expert Predictions & Calibration Outcomes...`);
  const predictionSeeds = [
    // Decision 1
    {
      decisionId: decisionsData[0]._id,
      contributorId: sarahUser._id,
      contributorName: sarahUser.name,
      predictionId: 'pred-cloud-egress-gcp',
      statement: 'Google Cloud multi-region API deployment will maintain <$0.02/GB cross-region data egress transfer spend.',
      probability: 0.85,
      domain: 'cloud-infrastructure',
      targetDate: new Date('2026-08-31'),
      evidenceReferences: ['Google Cloud FinOps Committed-Use Discount (CUD) Audit Benchmark'],
      outcome: {
        outcomeId: 'out-cloud-egress-gcp',
        observedOutcome: 1,
        verificationStatus: 'verified' as const,
        verificationSource: 'Q2 Cloud FinOps Data Billing Portal',
        outcomeDate: new Date(Date.now() - 2 * 86400000),
        verifiedById: daveUser._id,
        verifiedByName: daveUser.name,
        verifiedAt: new Date(Date.now() - 2 * 86400000),
      },
    },
    {
      decisionId: decisionsData[0]._id,
      contributorId: vikramUser._id,
      contributorName: vikramUser.name,
      predictionId: 'pred-aws-soc2-clean',
      statement: 'AWS migration infrastructure will achieve zero findings in the Q3 independent SOC 2 Type II audit.',
      probability: 0.95,
      domain: 'compliance',
      targetDate: new Date('2026-10-15'),
      evidenceReferences: ['SOC 2 Type II and FedRAMP High Compliance Matrix Comparison'],
    },

    // Decision 2
    {
      decisionId: decisionsData[1]._id,
      contributorId: presenterUser._id,
      contributorName: presenterUser.name,
      predictionId: 'pred-claude-eval-accuracy',
      statement: 'Anthropic Claude 3.5 Sonnet will achieve >90% first-pass pass rate on production SQL synthesis benchmarks.',
      probability: 0.90,
      domain: 'ai-engineering',
      targetDate: new Date('2026-06-30'),
      evidenceReferences: ['SWE-bench Verified & HumanEval Multi-Language Coding Leaderboard'],
      outcome: {
        outcomeId: 'out-claude-eval-accuracy',
        observedOutcome: 1,
        verificationStatus: 'verified' as const,
        verificationSource: 'Automated CI/CD Eval Harness Run #4419',
        outcomeDate: new Date(Date.now() - 1 * 86400000),
        verifiedById: presenterUser._id,
        verifiedByName: presenterUser.name,
        verifiedAt: new Date(Date.now() - 1 * 86400000),
      },
    },
    {
      decisionId: decisionsData[1]._id,
      contributorId: sarahUser._id,
      contributorName: sarahUser.name,
      predictionId: 'pred-gemini-ttft-throughput',
      statement: 'Gemini 2.5 Flash streaming endpoint will sustain <280ms P90 first-token response latency during 10,000 req/min peak spikes.',
      probability: 0.92,
      domain: 'ai-engineering',
      targetDate: new Date('2026-07-31'),
      evidenceReferences: ['Internal API Gateway Streaming TTFT Latency Test (10,000 requests)'],
    },

    // Decision 3
    {
      decisionId: decisionsData[2]._id,
      contributorId: rachelUser._id,
      contributorName: rachelUser.name,
      predictionId: 'pred-databricks-iceberg-read',
      statement: 'Apache Iceberg queries over Databricks UniForm tables will execute within 5% of native Delta engine performance.',
      probability: 0.88,
      domain: 'data-engineering',
      targetDate: new Date('2026-08-15'),
      evidenceReferences: ['Apache Iceberg & Delta Lake UniForm Benchmark on TPC-DS 10TB'],
    },
    {
      decisionId: decisionsData[2]._id,
      contributorId: daveUser._id,
      contributorName: daveUser.name,
      predictionId: 'pred-lakehouse-tco-savings',
      statement: 'Consolidating on modern lakehouse architecture will reduce legacy cluster maintenance expenses by at least $250k/year.',
      probability: 0.82,
      domain: 'finops',
      targetDate: new Date('2026-12-31'),
      evidenceReferences: ['Snowflake Cortex & Multi-Cluster Auto-Scaling Cost Model'],
    },

    // Decision 4
    {
      decisionId: decisionsData[3]._id,
      contributorId: sarahUser._id,
      contributorName: sarahUser.name,
      predictionId: 'pred-rust-zero-oom',
      statement: 'Axum Rust payment worker services will maintain zero out-of-memory container crashes under 50,000 TPS soak tests.',
      probability: 0.98,
      domain: 'systems-performance',
      targetDate: new Date('2026-09-15'),
      evidenceReferences: ['TechEmpower Framework Benchmarks Round 22 (JSON Serialization & DB)'],
      outcome: {
        outcomeId: 'out-rust-zero-oom',
        observedOutcome: 1,
        verificationStatus: 'verified' as const,
        verificationSource: 'Datadog APM 72-Hour Load Soak Dashboard',
        outcomeDate: new Date(Date.now() - 3 * 86400000),
        verifiedById: sarahUser._id,
        verifiedByName: sarahUser.name,
        verifiedAt: new Date(Date.now() - 3 * 86400000),
      },
    },
    {
      decisionId: decisionsData[3]._id,
      contributorId: leadUser._id,
      contributorName: leadUser.name,
      predictionId: 'pred-go-velocity-delivery',
      statement: 'Go microservice transaction ledger will ship to staging at least 3 weeks earlier than the equivalent Rust implementation.',
      probability: 0.88,
      domain: 'software-engineering',
      targetDate: new Date('2026-07-15'),
      evidenceReferences: ['Engineering Team Onboarding & Time-to-Production Velocity Study'],
    },
    {
      decisionId: decisionsData[0]._id,
      contributorId: daveUser._id,
      contributorName: daveUser.name,
      predictionId: 'pred-cloud-overall-tco',
      statement: 'Blended cloud unit cost per million transactions will decrease by >18% following completed migration.',
      probability: 0.84,
      domain: 'finops',
      targetDate: new Date('2026-12-31'),
      evidenceReferences: ['Google Cloud FinOps Committed-Use Discount (CUD) Audit Benchmark'],
    },
    {
      decisionId: decisionsData[1]._id,
      contributorId: vikramUser._id,
      contributorName: vikramUser.name,
      predictionId: 'pred-ai-gateway-zero-leak',
      statement: 'Zero PII data leakage incidents reported across all production AI gateway proxy routes during Q3.',
      probability: 0.94,
      domain: 'infosec',
      targetDate: new Date('2026-09-30'),
      evidenceReferences: ['Enterprise Zero-Data Retention (ZDR) Legal Agreement Terms'],
    },
  ];

  await ExpertPredictionModel.insertMany(predictionSeeds);
  console.log(`  ✓ Inserted ${predictionSeeds.length} expert outcome predictions and calibration records.`);

  // 11. Seed Decision Snapshots (10 total, 2-3 per decision)
  console.log(`\n[10/12] Seeding 10 Historical Decision Version Snapshots...`);
  const snapshotSeeds = [
    // Decision 1
    {
      snapshotId: 'snap-cloud-v1-draft',
      decisionId: decisionsData[0]._id,
      version: 1,
      title: decisionsData[0].title,
      description: decisionsData[0].description,
      criteria: decisionsData[0].criteria,
      options: decisionsData[0].options,
      scores: decisionsData[0].scores,
      analysis: null,
      metadata: { evidenceCount: 2, contributionCount: 1, predictionCount: 1, disagreementCount: 1 },
      snapshotReason: 'milestone' as const,
      snapshotNote: 'Initial draft established by Lead Decision Architect prior to formal stakeholder contribution round.',
      createdById: leadUser._id.toString(),
      createdAt: new Date(Date.now() - 6 * 86400000),
    },
    {
      snapshotId: 'snap-cloud-v2-calibrated',
      decisionId: decisionsData[0]._id,
      version: 2,
      title: decisionsData[0].title,
      description: decisionsData[0].description,
      criteria: decisionsData[0].criteria,
      options: decisionsData[0].options,
      scores: decisionsData[0].scores,
      analysis: { winnerId: 'opt-beta', pointLead: 4.0 },
      metadata: { evidenceCount: 4, contributionCount: 3, predictionCount: 3, disagreementCount: 2 },
      snapshotReason: 'calculation' as const,
      snapshotNote: 'Post-expert deliberation canonical calculation snapshot with verified weights.',
      createdById: leadUser._id.toString(),
      createdAt: new Date(Date.now() - 2 * 86400000),
    },

    // Decision 2
    {
      snapshotId: 'snap-llm-v1-baseline',
      decisionId: decisionsData[1]._id,
      version: 1,
      title: decisionsData[1].title,
      description: decisionsData[1].description,
      criteria: decisionsData[1].criteria,
      options: decisionsData[1].options,
      scores: decisionsData[1].scores,
      analysis: null,
      metadata: { evidenceCount: 1, contributionCount: 1, predictionCount: 1, disagreementCount: 0 },
      snapshotReason: 'milestone' as const,
      snapshotNote: 'Initial AI model selection matrix prior to internal latency soak test.',
      createdById: presenterUser._id.toString(),
      createdAt: new Date(Date.now() - 5 * 86400000),
    },
    {
      snapshotId: 'snap-llm-v2-eval-complete',
      decisionId: decisionsData[1]._id,
      version: 2,
      title: decisionsData[1].title,
      description: decisionsData[1].description,
      criteria: decisionsData[1].criteria,
      options: decisionsData[1].options,
      scores: decisionsData[1].scores,
      analysis: { winnerId: 'opt-claude', pointLead: 3.2 },
      metadata: { evidenceCount: 3, contributionCount: 3, predictionCount: 3, disagreementCount: 2 },
      snapshotReason: 'calculation' as const,
      snapshotNote: 'Incorporated SWE-bench verified accuracy scores and P90 streaming TTFT metrics.',
      createdById: presenterUser._id.toString(),
      createdAt: new Date(Date.now() - 1 * 86400000),
    },

    // Decision 3
    {
      snapshotId: 'snap-lakehouse-v1-initial',
      decisionId: decisionsData[2]._id,
      version: 1,
      title: decisionsData[2].title,
      description: decisionsData[2].description,
      criteria: decisionsData[2].criteria,
      options: decisionsData[2].options,
      scores: decisionsData[2].scores,
      analysis: null,
      metadata: { evidenceCount: 1, contributionCount: 1, predictionCount: 1, disagreementCount: 0 },
      snapshotReason: 'milestone' as const,
      snapshotNote: 'Pre-POC initial architectural survey across Snowflake, Databricks, and BigQuery.',
      createdById: rachelUser._id.toString(),
      createdAt: new Date(Date.now() - 6 * 86400000),
    },
    {
      snapshotId: 'snap-lakehouse-v2-poc-closed',
      decisionId: decisionsData[2]._id,
      version: 2,
      title: decisionsData[2].title,
      description: decisionsData[2].description,
      criteria: decisionsData[2].criteria,
      options: decisionsData[2].options,
      scores: decisionsData[2].scores,
      analysis: { winnerId: 'opt-bigquery', pointLead: 1.8 },
      metadata: { evidenceCount: 3, contributionCount: 3, predictionCount: 2, disagreementCount: 2 },
      snapshotReason: 'round_lock' as const,
      snapshotNote: 'Locked contribution round following 10TB TPC-DS benchmark completion.',
      createdById: rachelUser._id.toString(),
      createdAt: new Date(Date.now() - 2 * 86400000),
    },

    // Decision 4
    {
      snapshotId: 'snap-microservices-v1-draft',
      decisionId: decisionsData[3]._id,
      version: 1,
      title: decisionsData[3].title,
      description: decisionsData[3].description,
      criteria: decisionsData[3].criteria,
      options: decisionsData[3].options,
      scores: decisionsData[3].scores,
      analysis: null,
      metadata: { evidenceCount: 1, contributionCount: 1, predictionCount: 1, disagreementCount: 0 },
      snapshotReason: 'milestone' as const,
      snapshotNote: 'Initial framework comparison initiated by Core Engineering team.',
      createdById: leadUser._id.toString(),
      createdAt: new Date(Date.now() - 5 * 86400000),
    },
    {
      snapshotId: 'snap-microservices-v2-loadtest',
      decisionId: decisionsData[3]._id,
      version: 2,
      title: decisionsData[3].title,
      description: decisionsData[3].description,
      criteria: decisionsData[3].criteria,
      options: decisionsData[3].options,
      scores: decisionsData[3].scores,
      analysis: { winnerId: 'opt-go', pointLead: 2.4 },
      metadata: { evidenceCount: 4, contributionCount: 3, predictionCount: 2, disagreementCount: 2 },
      snapshotReason: 'calculation' as const,
      snapshotNote: 'Final calculation reflecting team velocity consensus and Axum performance soak testing.',
      createdById: leadUser._id.toString(),
      createdAt: new Date(Date.now() - 1 * 86400000),
    },
    {
      snapshotId: 'snap-cloud-v3-round-lock',
      decisionId: decisionsData[0]._id,
      version: 3,
      title: decisionsData[0].title,
      description: decisionsData[0].description,
      criteria: decisionsData[0].criteria,
      options: decisionsData[0].options,
      scores: decisionsData[0].scores,
      analysis: { winnerId: 'opt-beta', pointLead: 4.0 },
      metadata: { evidenceCount: 4, contributionCount: 3, predictionCount: 3, disagreementCount: 2 },
      snapshotReason: 'round_lock' as const,
      snapshotNote: 'Formal contribution round locked by Lead Architect for executive steering committee review.',
      createdById: leadUser._id.toString(),
      createdAt: new Date(Date.now() - 1 * 86400000),
    },
    {
      snapshotId: 'snap-llm-v3-governance-review',
      decisionId: decisionsData[1]._id,
      version: 3,
      title: decisionsData[1].title,
      description: decisionsData[1].description,
      criteria: decisionsData[1].criteria,
      options: decisionsData[1].options,
      scores: decisionsData[1].scores,
      analysis: { winnerId: 'opt-claude', pointLead: 3.2 },
      metadata: { evidenceCount: 3, contributionCount: 3, predictionCount: 3, disagreementCount: 2 },
      snapshotReason: 'milestone' as const,
      snapshotNote: 'Governance review milestone approved by CISO Advisory committee.',
      createdById: presenterUser._id.toString(),
      createdAt: new Date(Date.now() - 12 * 3600000),
    },
  ];

  await DecisionSnapshotModel.insertMany(snapshotSeeds);
  console.log(`  ✓ Inserted ${snapshotSeeds.length} version snapshots.`);

  // 12. Seed Operation Journal & Outbox Records (10 total each)
  console.log(`\n[11/12] Seeding Operation Journals & Distributed Outbox Records...`);
  const journalSeeds = decisionsData.map((d, idx) => ({
    operationId: randomUUID(),
    decisionId: d._id,
    action: 'decision.score_update',
    actor: {
      id: d.ownerId.toString(),
      role: 'owner',
      name: d.ownerId.toString() === leadUser._id.toString() ? leadUser.name : (d.ownerId.toString() === presenterUser._id.toString() ? presenterUser.name : rachelUser.name),
      email: d.ownerId.toString() === leadUser._id.toString() ? leadUser.email : (d.ownerId.toString() === presenterUser._id.toString() ? presenterUser.email : rachelUser.email),
    },
    expectedVersion: 1,
    targetVersion: 2,
    state: 'COMPLETED' as const,
    payload: { scores: d.scores },
    previousSnapshot: { scores: {} },
    auditDraft: {
      eventId: randomUUID(),
      entityType: 'decision',
      entityId: d._id.toString(),
      summary: `Calibrated scores on ${d.title}`,
      diff: { scores: d.scores },
    },
  }));

  await OperationJournalModel.insertMany(journalSeeds);

  const outboxSeeds = decisionsData.map((d) => {
    const notifId = randomUUID();
    return {
      notificationId: notifId,
      decisionId: d._id,
      eventType: 'DECISION_UPDATED',
      payload: { decisionId: d._id.toString(), title: d.title, version: 2 },
      status: 'DELIVERED' as const,
      leaseExpiresAt: new Date(Date.now() + 3600000),
      retryCount: 0,
    };
  });

  await NotificationOutboxModel.insertMany(outboxSeeds);

  const consumerSeeds = outboxSeeds.map((out) => ({
    consumerId: 'realtime-sse-broadcaster',
    notificationId: out.notificationId,
    idempotencyKey: `sse-dispatch-${out.notificationId}`,
    status: 'COMPLETED' as const,
    completedAt: new Date(),
    processedAt: new Date(),
  }));

  await NotificationConsumerRecordModel.insertMany(consumerSeeds);
  console.log(`  ✓ Inserted ${journalSeeds.length} operation journal transactions, ${outboxSeeds.length} outbox notifications, and ${consumerSeeds.length} consumer acknowledgements.`);

  // 13. Cryptographically Chained Audit Events (2-3 additional chained events per decision)
  console.log(`\n[12/12] Linking Additional Tamper-Evident SHA-256 Audit Trails...`);
  for (const d of decisionsData) {
    const existingGenesis = await AuditEventModel.findOne({ decisionId: d._id, sequenceNumber: 1 });
    if (!existingGenesis) continue;

    let prevHash = existingGenesis.eventHash;
    const actions = [
      { action: 'decision.evidence_attached', summary: `Empirical evidence documentation attached to ${d.title}` },
      { action: 'contribution.submitted', summary: `Expert multi-criteria calibration submitted for ${d.title}` },
      { action: 'decision.snapshot_created', summary: `Milestone version snapshot captured for ${d.title}` },
    ];

    for (let seq = 2; seq <= 4; seq++) {
      const act = actions[seq - 2];
      const eventId = randomUUID();
      const ts = new Date(Date.now() - (5 - seq) * 86400000);

      const hash = computeCanonicalEventHash({
        eventId,
        decisionId: d._id.toString(),
        actorId: d.ownerId.toString(),
        action: act.action,
        entityType: 'decision',
        entityId: d._id.toString(),
        summary: act.summary,
        timestamp: ts,
        originalTimestamp: ts,
        previousEventHash: prevHash,
        schemaVersion: 1,
        sequenceNumber: seq,
      });

      await AuditEventModel.create({
        eventId,
        decisionId: d._id,
        actorId: d.ownerId.toString(),
        actorEmail: d.ownerId.toString() === leadUser._id.toString() ? leadUser.email : (d.ownerId.toString() === presenterUser._id.toString() ? presenterUser.email : rachelUser.email),
        actorName: d.ownerId.toString() === leadUser._id.toString() ? leadUser.name : (d.ownerId.toString() === presenterUser._id.toString() ? presenterUser.name : rachelUser.name),
        action: act.action,
        entityType: 'decision',
        entityId: d._id.toString(),
        summary: act.summary,
        timestamp: ts,
        originalTimestamp: ts,
        previousEventHash: prevHash,
        eventHash: hash,
        sequenceNumber: seq,
        schemaVersion: 1,
      });

      prevHash = hash;

      // Update decision auditHead to point to the latest sequence
      await DecisionModel.updateOne(
        { _id: d._id },
        {
          $set: {
            'auditHead.sequenceNumber': seq,
            'auditHead.eventHash': hash,
            'auditHead.lastEventId': eventId,
            'auditHead.updatedAt': ts,
          },
        }
      );
    }
  }
  console.log(`  ✓ Cryptographically chained audit event sequence #1 -> #4 across all 4 decisions.`);

  // Print Summary
  console.log('\n================================================================');
  console.log(' SEEDING COMPLETE — ALL MONGO COLLECTIONS POPULATED');
  console.log('================================================================');
  console.log(` Canonical Decision 1: http://localhost:5173/?decisionId=${decisionsData[0]._id}`);
  console.log(` AI Gateway Decision 2:  http://localhost:5173/?decisionId=${decisionsData[1]._id}`);
  console.log(` Lakehouse Decision 3:   http://localhost:5173/?decisionId=${decisionsData[2]._id}`);
  console.log(` Microservices Dec 4:    http://localhost:5173/?decisionId=${decisionsData[3]._id}`);
  console.log('----------------------------------------------------------------');
  console.log(` Demo User Password (All): ${DEFAULT_PASSWORD}`);
  for (const u of VAST_DEMO_USERS) {
    console.log(` - ${u.email.padEnd(36)}: ${u.title}`);
  }
  console.log('================================================================\n');

  await disconnectFromDatabase();
  return { success: true };
}

if (process.argv[1]?.endsWith('seed_vast_demo_data.ts') || process.argv[1]?.endsWith('seed_vast_demo_data.js')) {
  seedVastDatabase().then(() => process.exit(0)).catch((err) => {
    console.error('Vast seed failed:', err);
    process.exit(1);
  });
}
