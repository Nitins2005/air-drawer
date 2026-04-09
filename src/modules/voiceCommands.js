/**
 * Voice Command Engine
 * Uses the Web Speech API for continuous voice recognition.
 * Listens for keywords and triggers corresponding actions.
 */

const COMMAND_MAP = {
  // Drawing actions
  'undo': 'UNDO',
  'go back': 'UNDO',
  'redo': 'REDO',
  'clear': 'CLEAR',
  'clear all': 'CLEAR',
  'erase all': 'CLEAR',
  'save': 'SAVE',
  'download': 'SAVE',
  'export': 'SAVE',

  // Colors
  'red': 'COLOR_RED',
  'blue': 'COLOR_BLUE',
  'cyan': 'COLOR_CYAN',
  'green': 'COLOR_GREEN',
  'yellow': 'COLOR_YELLOW',
  'pink': 'COLOR_PINK',
  'magenta': 'COLOR_PINK',
  'white': 'COLOR_WHITE',

  // Brush size
  'bigger': 'BRUSH_BIGGER',
  'larger': 'BRUSH_BIGGER',
  'thicker': 'BRUSH_BIGGER',
  'increase': 'BRUSH_BIGGER',
  'smaller': 'BRUSH_SMALLER',
  'thinner': 'BRUSH_SMALLER',
  'decrease': 'BRUSH_SMALLER',
  'thin': 'BRUSH_SMALLER',
  'thick': 'BRUSH_BIGGER',

  // Toggles
  'hide camera': 'TOGGLE_CAMERA',
  'show camera': 'TOGGLE_CAMERA',
  'camera': 'TOGGLE_CAMERA',
  'gestures on': 'TOGGLE_GESTURES',
  'gestures off': 'TOGGLE_GESTURES',
  'toggle gestures': 'TOGGLE_GESTURES',

  // Help
  'help': 'HELP',
  'help me': 'HELP',
};

const COLOR_VALUES = {
  COLOR_RED: '#ff0000',
  COLOR_BLUE: '#0088ff',
  COLOR_CYAN: '#00ffff',
  COLOR_GREEN: '#00ff00',
  COLOR_YELLOW: '#ffff00',
  COLOR_PINK: '#ff00ff',
  COLOR_WHITE: '#ffffff',
};

export class VoiceCommandEngine {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.onCommand = null;        // callback(commandName, rawTranscript)
    this.onStateChange = null;    // callback(isListening)
    this.onTranscript = null;     // callback(transcript, isFinal)
    this.onError = null;          // callback(error)
    this.supported = false;
    this._restartTimeout = null;

    this._init();
  }

  _init() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[VoiceCommands] Speech Recognition not supported in this browser.');
      this.supported = false;
      return;
    }

    this.supported = true;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'en-US';
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim().toLowerCase();

        if (this.onTranscript) {
          this.onTranscript(transcript, result.isFinal);
        }

        if (result.isFinal) {
          this._matchCommand(transcript);
        }
      }
    };

    this.recognition.onerror = (event) => {
      // 'no-speech' is expected when the user isn't talking
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('[VoiceCommands] Error:', event.error);
      if (this.onError) this.onError(event.error);
    };

    this.recognition.onend = () => {
      // Auto-restart if we should still be listening
      if (this.isListening) {
        clearTimeout(this._restartTimeout);
        this._restartTimeout = setTimeout(() => {
          try {
            this.recognition.start();
          } catch (e) {
            // Already started
          }
        }, 300);
      }
    };
  }

  _matchCommand(transcript) {
    // Check for exact matches first, then partial matches (longest first)
    const sortedKeys = Object.keys(COMMAND_MAP).sort((a, b) => b.length - a.length);

    for (const key of sortedKeys) {
      if (transcript.includes(key)) {
        const command = COMMAND_MAP[key];
        if (this.onCommand) {
          this.onCommand(command, key, COLOR_VALUES[command] || null);
        }
        return;
      }
    }
  }

  start() {
    if (!this.supported || this.isListening) return;
    this.isListening = true;
    try {
      this.recognition.start();
    } catch (e) {
      // Already started
    }
    if (this.onStateChange) this.onStateChange(true);
  }

  stop() {
    if (!this.supported || !this.isListening) return;
    this.isListening = false;
    clearTimeout(this._restartTimeout);
    try {
      this.recognition.stop();
    } catch (e) {
      // Already stopped
    }
    if (this.onStateChange) this.onStateChange(false);
  }

  toggle() {
    if (this.isListening) {
      this.stop();
    } else {
      this.start();
    }
  }

  destroy() {
    this.stop();
    if (this.recognition) {
      this.recognition.onresult = null;
      this.recognition.onerror = null;
      this.recognition.onend = null;
    }
    this.recognition = null;
  }
}

export { COMMAND_MAP, COLOR_VALUES };
