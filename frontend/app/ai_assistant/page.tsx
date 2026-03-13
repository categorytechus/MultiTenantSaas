'use client';

import { useState, useRef, useEffect } from 'react';
import Layout from '../../components/Layout';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function AIAssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I\'m your AI Assistant. I can help you with documents, answer questions, and guide you through the platform. How can I assist you today?',
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Simulate AI response (replace with actual API call)
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I\'m currently in demo mode. To enable full AI capabilities, please integrate with your preferred LLM provider (OpenAI, Anthropic, etc.). I can help you with:\n\n• Document management and search\n• Workflow automation\n• Data analysis\n• General assistance',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, aiMessage]);
      setIsTyping(false);
    }, 1500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <Layout>
      <style>{`
        .chat-container {
          height: calc(100vh - 60px);
          display: flex;
          flex-direction: column;
          background: #faf9f7;
        }

        .chat-header {
          padding: 20px 32px;
          background: white;
          border-bottom: 1px solid #ebebeb;
        }
        .chat-title {
          font-size: 20px;
          font-weight: 700;
          color: #1a1a1a;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .chat-title-icon {
          width: 32px;
          height: 32px;
          background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }
        .chat-subtitle {
          font-size: 13px;
          color: #666;
          margin-top: 4px;
        }

        .messages-container {
          flex: 1;
          overflow-y: auto;
          padding: 24px 32px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .message {
          display: flex;
          gap: 12px;
          max-width: 70%;
          animation: slideIn 0.3s ease;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .message.user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }

        .message-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 18px;
        }
        .message.assistant .message-avatar {
          background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
          color: white;
        }
        .message.user .message-avatar {
          background: #1a1a1a;
          color: white;
          font-size: 12px;
          font-weight: 600;
        }

        .message-content {
          flex: 1;
        }
        .message-bubble {
          padding: 12px 16px;
          border-radius: 12px;
          font-size: 14px;
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .message.assistant .message-bubble {
          background: white;
          border: 1px solid #ebebeb;
          color: #1a1a1a;
          border-bottom-left-radius: 4px;
        }
        .message.user .message-bubble {
          background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
          color: white;
          border-bottom-right-radius: 4px;
        }
        .message-time {
          font-size: 11px;
          color: #666;
          margin-top: 4px;
          padding: 0 4px;
        }
        .message.user .message-time {
          text-align: right;
        }

        .typing-indicator {
          display: flex;
          gap: 12px;
          max-width: 70%;
        }
        .typing-dots {
          background: white;
          border: 1px solid #ebebeb;
          padding: 12px 20px;
          border-radius: 12px;
          border-bottom-left-radius: 4px;
          display: flex;
          gap: 6px;
        }
        .typing-dot {
          width: 8px;
          height: 8px;
          background: #666;
          border-radius: 50%;
          animation: typing 1.4s infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typing {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-10px); }
        }

        .input-container {
          padding: 20px 32px 24px;
          background: white;
          border-top: 1px solid #ebebeb;
        }
        .input-wrapper {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          max-width: 900px;
          margin: 0 auto;
        }
        .input-box {
          flex: 1;
          position: relative;
        }
        .input-textarea {
          width: 100%;
          padding: 14px 16px;
          border: 1.5px solid #d1d5db;
          border-radius: 12px;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          color: #1a1a1a;
          resize: none;
          outline: none;
          transition: all 0.2s;
          line-height: 1.5;
          max-height: 120px;
        }
        .input-textarea:focus {
          border-color: #8b5cf6;
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.1);
        }
        .input-textarea::placeholder {
          color: #9a9a9a;
        }

        .send-button {
          width: 48px;
          height: 48px;
          background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
          border: none;
          border-radius: 12px;
          color: white;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          flex-shrink: 0;
        }
        .send-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 20px rgba(139, 92, 246, 0.3);
        }
        .send-button:active {
          transform: translateY(0);
        }
        .send-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
        }
        .send-button svg {
          width: 20px;
          height: 20px;
        }

        .quick-actions {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          flex-wrap: wrap;
        }
        .quick-action {
          padding: 6px 14px;
          background: #f5f4f1;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 12px;
          color: #1a1a1a;
          cursor: pointer;
          transition: all 0.2s;
        }
        .quick-action:hover {
          background: white;
          border-color: #8b5cf6;
          color: #8b5cf6;
        }

        @media (max-width: 768px) {
          .message {
            max-width: 85%;
          }
          .messages-container {
            padding: 16px;
          }
          .input-container {
            padding: 16px;
          }
        }
      `}</style>

      <div className="chat-container">
        <div className="chat-header">
          <div className="chat-title">
            <div className="chat-title-icon">
              <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"/>
              </svg>
            </div>
            AI Assistant
          </div>
          <div className="chat-subtitle">
            Ask me anything about your documents, workflows, or the platform
          </div>
        </div>

        <div className="messages-container">
          {messages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              <div className="message-avatar">
                {message.role === 'assistant' ? '✨' : 'U'}
              </div>
              <div className="message-content">
                <div className="message-bubble">{message.content}</div>
                <div className="message-time">{formatTime(message.timestamp)}</div>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="typing-indicator">
              <div className="message-avatar" style={{ background: 'linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)', color: 'white' }}>
                ✨
              </div>
              <div className="typing-dots">
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
                <div className="typing-dot"></div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="input-container">
          <div className="input-wrapper">
            <div className="input-box">
              <textarea
                className="input-textarea"
                placeholder="Type your message..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                rows={1}
                disabled={isTyping}
              />
            </div>
            <button
              className="send-button"
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
            >
              <svg fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>

          <div className="quick-actions">
            <button className="quick-action" onClick={() => setInput('Search for documents about...')}>
              🔍 Search documents
            </button>
            <button className="quick-action" onClick={() => setInput('Summarize...')}>
              📝 Summarize content
            </button>
            <button className="quick-action" onClick={() => setInput('Help me with...')}>
              💡 Get help
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}