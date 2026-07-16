import express from 'express';
import {
  createConversation,
  getConversations,
  getConversationById,
  renameConversation,
  deleteConversation,
  handleChatMessage,
  handleChatStream,
  editChatMessage,
} from '../controllers/conversationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);

router.route('/chat/stream').post(handleChatStream);
router.route('/chat').post(handleChatMessage);
router.route('/chat/edit').post(editChatMessage);

// Conversation endpoints
router.route('/conversations').post(createConversation).get(getConversations);

// Single conversation endpoints
router.route('/conversations/:id')
  .get(getConversationById)
  .put(renameConversation)
  .delete(deleteConversation);

export default router;
