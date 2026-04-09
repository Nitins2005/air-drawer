import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff } from 'lucide-react';
import { VoiceCommandEngine } from '../modules/voiceCommands';

/**
 * VoiceCommandPanel
 *
 * Floating mic button + a live transcript toast that fades in/out.
 * When a command is recognised, a confirmation toast briefly appears.
 */
export default function VoiceCommandPanel({ onVoiceCommand, onTranscript }) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [transcript, setTranscript] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [lastCommand, setLastCommand] = useState(null);
  const [showCommand, setShowCommand] = useState(false);

  const engineRef = useRef(null);
  const hideTranscriptTimer = useRef(null);
  const hideCommandTimer = useRef(null);

  useEffect(() => {
    const engine = new VoiceCommandEngine();
    engineRef.current = engine;
    setSupported(engine.supported);

    engine.onStateChange = (isListening) => {
      setListening(isListening);
    };

    engine.onTranscript = (text, isFinal) => {
      setTranscript(text);
      setShowTranscript(true);
      clearTimeout(hideTranscriptTimer.current);
      if (isFinal) {
        if (onTranscript) onTranscript(text);
        hideTranscriptTimer.current = setTimeout(() => {
          setShowTranscript(false);
        }, 1500);
      }
    };

    engine.onCommand = (command, keyword, colorValue) => {
      setLastCommand({ command, keyword });
      setShowCommand(true);
      clearTimeout(hideCommandTimer.current);
      hideCommandTimer.current = setTimeout(() => setShowCommand(false), 2000);

      if (onVoiceCommand) {
        onVoiceCommand(command, colorValue);
      }
    };

    engine.onError = (error) => {
      console.warn('[Voice] Error:', error);
    };

    return () => {
      engine.destroy();
      clearTimeout(hideTranscriptTimer.current);
      clearTimeout(hideCommandTimer.current);
    };
  }, [onVoiceCommand]);

  const toggle = useCallback(() => {
    engineRef.current?.toggle();
  }, []);

  if (!supported) return null;

  return (
    <>
      {/* Mic toggle button — fixed bottom-left */}
      <motion.button
        id="voice-toggle-btn"
        className="glass-meta"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.9 }}
        onClick={toggle}
        style={{
          position: 'fixed',
          bottom: '28px',
          left: '28px',
          zIndex: 90,
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: listening ? '#00ffff' : 'rgba(255, 255, 255, 0.6)',
          transition: 'color 0.3s, box-shadow 0.3s',
          boxShadow: listening
            ? '0 0 20px 4px rgba(0, 255, 255, 0.35), inset 0 0 12px rgba(0, 255, 255, 0.1)'
            : undefined,
        }}
        title={listening ? 'Stop voice commands' : 'Start voice commands'}
      >
        {listening ? <Mic size={22} /> : <MicOff size={22} />}

        {/* Pulsing ring when listening */}
        {listening && (
          <motion.div
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
            style={{
              position: 'absolute',
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              border: '2px solid rgba(0, 255, 255, 0.4)',
              pointerEvents: 'none',
            }}
          />
        )}
      </motion.button>

      {/* Listening label */}
      <AnimatePresence>
        {listening && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            style={{
              position: 'fixed',
              bottom: '88px',
              left: '16px',
              zIndex: 90,
              color: 'rgba(0, 255, 255, 0.8)',
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              pointerEvents: 'none',
              textAlign: 'center',
              width: '76px',
            }}
          >
            🎙️ Listening…
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live transcript toast */}
      <AnimatePresence>
        {showTranscript && transcript && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="glass-meta"
            style={{
              position: 'fixed',
              bottom: '28px',
              left: '96px',
              zIndex: 85,
              padding: '10px 18px',
              borderRadius: '16px',
              color: 'rgba(255, 255, 255, 0.7)',
              fontSize: '13px',
              maxWidth: '320px',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              fontStyle: 'italic',
              pointerEvents: 'none',
            }}
          >
            "{transcript}"
          </motion.div>
        )}
      </AnimatePresence>

      {/* Command confirmation toast */}
      <AnimatePresence>
        {showCommand && lastCommand && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 30 }}
            style={{
              position: 'fixed',
              bottom: '100px',
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 200,
              padding: '12px 28px',
              borderRadius: '999px',
              background: 'linear-gradient(135deg, rgba(0, 255, 255, 0.15) 0%, rgba(0, 200, 255, 0.08) 100%)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(0, 255, 255, 0.3)',
              color: '#00ffff',
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              boxShadow: '0 8px 32px rgba(0, 255, 255, 0.2)',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '16px' }}>✓</span>
            {lastCommand.command.replace(/_/g, ' ')}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
