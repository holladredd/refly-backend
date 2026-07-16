import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    default: 'New Conversation',
  },
  modelUsed: {
    type: String,
    default: 'grok-4.5',
  },
}, {
  timestamps: true,
});

const Conversation = mongoose.model('Conversation', conversationSchema);
export default Conversation;
