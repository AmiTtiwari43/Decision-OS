import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config({ path: 'apps/api/.env' });

async function check() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/decision_os';
  console.log('Connecting to:', uri.split('@').pop());
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  if (!mongoose.connection.db) {
    throw new Error('Database connection failed');
  }
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log('\n--- Atlas Collections in decision_os ---');
  for (const c of collections) {
    const count = await mongoose.connection.db.collection(c.name).countDocuments();
    console.log(c.name.padEnd(30), ':', count, 'documents');
  }
  await mongoose.disconnect();
  console.log('Done.');
}

check().catch(console.error);
