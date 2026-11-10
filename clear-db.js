require('dotenv').config();
const mongoose = require('mongoose');

console.log('⏳ Connecting to MongoDB...');

mongoose.connect(process.env.MONGODB_URI)
    .then(async () => {
        console.log('✅ Connected!');
        try {
            await mongoose.connection.db.dropCollection('sessions');
            console.log('🔥 All old sessions deleted successfully!');
        } catch (e) {
            console.log('ℹ️ No sessions found or already deleted.');
        }
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Error:', err.message);
        process.exit(1);
    });