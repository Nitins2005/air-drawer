import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import CameraView from './components/CameraView';
import DrawingCanvas from './components/DrawingCanvas';
import HelpPanel from './components/HelpPanel';
import ControlPanel from './components/ControlPanel';
import VoiceCommandPanel from './components/VoiceCommandPanel';
import { GestureInterpreter, CONTROL_GESTURES } from './modules/gestureInterpreter';
import { GESTURES } from './modules/gestureController';
import { motion, AnimatePresence } from 'framer-motion';
import { jsPDF } from 'jspdf';
import Tesseract from 'tesseract.js';
import './App.css';

function App() {
  const [settings, setSettings] = useState({
    color: '#00ffff',
    lineWidth: 8,
    autoShape: true,
    glowIntensity: 20,
  });

  // Primary hand (drawing)
  const [gesture, setGesture] = useState(GESTURES.IDLE);
  const [landmark, setLandmark] = useState(null);
  const [fingertips, setFingertips] = useState([]);

  // Secondary hand (control)
  const [controlGesture, setControlGesture] = useState(CONTROL_GESTURES.IDLE);
  const [controlLandmark, setControlLandmark] = useState(null);
  const [controlFingertips, setControlFingertips] = useState([]);
  const [controlPinchDelta, setControlPinchDelta] = useState(0);
  const [controlAngleDelta, setControlAngleDelta] = useState(0);

  const [cameraVisible, setCameraVisible] = useState(true);
  const [gesturesEnabled, setGesturesEnabled] = useState(true);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [transcripts, setTranscripts] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  const canvasRef = useRef(null);
  const interpreter = useMemo(() => new GestureInterpreter(), []);

  const onResults = useCallback((results) => {
    if (!gesturesEnabled) {
      setGesture(GESTURES.IDLE);
      setLandmark(null);
      setFingertips([]);
      setControlGesture(CONTROL_GESTURES.IDLE);
      setControlLandmark(null);
      setControlFingertips([]);
      return;
    }

    const { primary, secondary } = interpreter.interpret(results);

    // Primary hand
    setGesture(primary.gesture);
    setLandmark(primary.landmark);
    setFingertips(primary.fingertips);

    // Secondary hand
    setControlGesture(secondary.gesture);
    setControlLandmark(secondary.landmark);
    setControlFingertips(secondary.fingertips);
    setControlPinchDelta(secondary.pinchDelta);
    setControlAngleDelta(secondary.angleDelta);
  }, [interpreter, gesturesEnabled]);

  const handleSave = async () => {
    if (isSaving) return;
    
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas) return;

    setIsSaving(true);
    const timestamp = Date.now();

    try {
      // 1. Prepare canvas for OCR (Tesseract works better on white background)
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tCtx = tempCanvas.getContext('2d');
      tCtx.fillStyle = 'white';
      tCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      tCtx.drawImage(canvas, 0, 0);

      // 2. Perform OCR
      const { data: { text } } = await Tesseract.recognize(tempCanvas, 'eng');
      console.log('Recognized text:', text);

      // 3. Save as PDF with Text
      const pdf = new jsPDF();
      pdf.setFontSize(16);
      pdf.text("AirDrawer - Recognized Text", 10, 20);
      pdf.setFontSize(12);
      
      const splitText = pdf.splitTextToSize(text || "No text recognized.", 180);
      pdf.text(splitText, 10, 40);
      
      // Also add the drawing image to the second page of PDF
      pdf.addPage();
      pdf.text("Drawing Reference", 10, 20);
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 10, 30, 190, (190 * canvas.height) / canvas.width);
      
      pdf.save(`air-writing-${timestamp}.pdf`);

      // 4. Still save the raw PNG and Transcripts text for completeness
      const pngLink = document.createElement('a');
      pngLink.href = canvas.toDataURL('image/png');
      pngLink.download = `air-drawing-${timestamp}.png`;
      pngLink.click();

      if (transcripts.length > 0) {
        const textBlob = new Blob([transcripts.join('\n')], { type: 'text/plain' });
        const textUrl = URL.createObjectURL(textBlob);
        const textLink = document.createElement('a');
        textLink.href = textUrl;
        textLink.download = `voice-transcript-${timestamp}.txt`;
        textLink.click();
        URL.revokeObjectURL(textUrl);
      }
    } catch (error) {
      console.error('Save failed:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTranscript = useCallback((text) => {
    setTranscripts(prev => [...prev, text]);
  }, []);

  // Voice command handler
  const handleVoiceCommand = useCallback((command, colorValue) => {
    switch (command) {
      case 'UNDO':
        canvasRef.current?.undo();
        break;
      case 'REDO':
        canvasRef.current?.redo();
        break;
      case 'CLEAR':
        canvasRef.current?.clear();
        setTranscripts([]);
        break;
      case 'SAVE': {
        handleSave();
        break;
      }
      case 'COLOR_RED':
      case 'COLOR_BLUE':
      case 'COLOR_CYAN':
      case 'COLOR_GREEN':
      case 'COLOR_YELLOW':
      case 'COLOR_PINK':
      case 'COLOR_WHITE':
        if (colorValue) {
          setSettings(prev => ({ ...prev, color: colorValue }));
        }
        break;
      case 'BRUSH_BIGGER':
        setSettings(prev => ({ ...prev, lineWidth: Math.min(50, prev.lineWidth + 5) }));
        break;
      case 'BRUSH_SMALLER':
        setSettings(prev => ({ ...prev, lineWidth: Math.max(1, prev.lineWidth - 5) }));
        break;
      case 'TOGGLE_CAMERA':
        setCameraVisible(prev => !prev);
        break;
      case 'TOGGLE_GESTURES':
        setGesturesEnabled(prev => !prev);
        break;
      case 'HELP':
        setIsHelpOpen(true);
        break;
      default:
        break;
    }
  }, []);

  // Determine active mode label for the HUD
  const activeMode = controlGesture !== CONTROL_GESTURES.IDLE
    ? controlGesture.replace('CTRL_', '')
    : gesture;

  return (
    <div className="app-container">
      {cameraVisible && (
        <CameraView
          onResults={onResults}
        />
      )}

      <DrawingCanvas
        ref={canvasRef}
        settings={settings}
        gesture={gesture}
        landmark={landmark}
        autoShape={settings.autoShape}
        controlGesture={controlGesture}
        controlLandmark={controlLandmark}
        controlPinchDelta={controlPinchDelta}
        controlAngleDelta={controlAngleDelta}
      />

      <ControlPanel
        settings={settings}
        onSettingsChange={(newSettings) => setSettings(prev => ({ ...prev, ...newSettings }))}
        onClear={() => {
          canvasRef.current?.clear();
          setTranscripts([]);
        }}
        onUndo={() => canvasRef.current?.undo()}
        onRedo={() => canvasRef.current?.redo()}
        onSave={handleSave}
        onToggleCamera={() => setCameraVisible(!cameraVisible)}
        cameraVisible={cameraVisible}
        gestureVisible={gesturesEnabled}
        onToggleGestures={() => setGesturesEnabled(!gesturesEnabled)}
        onHelp={() => setIsHelpOpen(true)}
      />

      <HelpPanel isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

      <VoiceCommandPanel 
        onVoiceCommand={handleVoiceCommand} 
        onTranscript={handleTranscript}
      />

      {/* Saving Loader */}
      <AnimatePresence>
        {isSaving && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: 'fixed',
              top: 0, left: 0,
              width: '100%', height: '100%',
              backgroundColor: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(10px)',
              zIndex: 1000,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              color: '#00ffff'
            }}
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              style={{
                width: '60px',
                height: '60px',
                border: '4px solid rgba(0, 255, 255, 0.1)',
                borderTop: '4px solid #00ffff',
                borderRadius: '50%',
                marginBottom: '20px'
              }}
            />
            <div style={{ fontSize: '18px', fontWeight: 600, letterSpacing: '0.1em' }}>
              RECOGNIZING HANDWRITING...
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Gesture Status */}
      <AnimatePresence>
        {activeMode !== 'IDLE' && activeMode !== CONTROL_GESTURES.IDLE && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="gesture-status glass-meta"
          >
            {activeMode} MODE
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Hand Fingertip Indicators */}
      {fingertips.map((tip, i) => {
        if (!tip) return null;
        const x = (1 - tip.x) * window.innerWidth;
        const y = tip.y * window.innerHeight;

        let size = '10px';
        let opacity = 0.6;
        let color = settings.color;
        let shadow = `0 0 10px 2px ${color}`;

        if (i === 1) { // Index finger
          if (gesture === 'ERASE') {
            size = '60px';
            color = 'transparent';
            shadow = '0 0 15px 4px rgba(255, 0, 0, 0.8), inset 0 0 10px 2px rgba(255, 0, 0, 0.5)';
            opacity = 1;
          } else {
            size = '16px';
            opacity = 1;
            shadow = `0 0 15px 4px ${color}`;
          }
        }

        return (
          <div
            key={`p-${i}`}
            style={{
              position: 'fixed',
              left: x, top: y,
              width: size, height: size,
              backgroundColor: color,
              border: gesture === 'ERASE' ? '2px solid rgba(255, 50, 50, 0.8)' : 'none',
              borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              boxShadow: shadow,
              opacity,
              zIndex: 40,
              pointerEvents: 'none',
              transition: 'width 0.1s, height 0.1s',
            }}
          />
        );
      })}

      {/* Secondary Hand Fingertip Indicators (distinct style) */}
      {controlFingertips.map((tip, i) => {
        if (!tip) return null;
        const x = (1 - tip.x) * window.innerWidth;
        const y = tip.y * window.innerHeight;

        let size = '10px';
        let opacity = 0.5;
        let color = 'transparent';
        let shadow = '0 0 8px 2px rgba(255, 165, 0, 0.5)';
        let border = '1.5px solid rgba(255, 165, 0, 0.6)';

        // Index finger of control hand
        if (i === 1) {
          size = '18px';
          opacity = 1;
          if (controlGesture === CONTROL_GESTURES.MOVE) {
            shadow = '0 0 20px 4px rgba(100, 180, 255, 0.8)';
            border = '2px solid rgba(100, 180, 255, 0.8)';
          } else if (controlGesture === CONTROL_GESTURES.SCALE) {
            shadow = '0 0 20px 4px rgba(0, 255, 200, 0.8)';
            border = '2px solid rgba(0, 255, 200, 0.8)';
          } else if (controlGesture === CONTROL_GESTURES.ROTATE) {
            shadow = '0 0 20px 4px rgba(255, 165, 0, 0.8)';
            border = '2px solid rgba(255, 165, 0, 0.8)';
          }
        }

        return (
          <div
            key={`s-${i}`}
            style={{
              position: 'fixed',
              left: x, top: y,
              width: size, height: size,
              backgroundColor: color,
              border,
              borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              boxShadow: shadow,
              opacity,
              zIndex: 40,
              pointerEvents: 'none',
              transition: 'width 0.1s, height 0.1s',
            }}
          />
        );
      })}

      {!landmark && !controlLandmark && (
        <div className="overlay-message">
          👋 Raise your hand to start drawing
        </div>
      )}
    </div>
  );
}

export default App;
