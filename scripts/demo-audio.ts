// Deterministic test tone, not speech or a voice-model accuracy fixture.
export function demoAudio(seconds = 3, rate = 16000): Buffer {
  const length = Math.round(seconds * rate), wav = Buffer.alloc(44 + length * 2);
  wav.write("RIFF"); wav.writeUInt32LE(36 + length * 2, 4);
  wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++)
    wav.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 880) * 1500), 44 + i * 2);
  return wav;
}
