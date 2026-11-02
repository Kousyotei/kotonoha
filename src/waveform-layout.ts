// Every bar is placed by audio time, not stretched to the project's duration.
export function waveformBar(
  index: number,
  count: number,
  audioDuration: number,
  timelineDuration: number,
  width: number,
) {
  const time = (index / count) * audioDuration;
  return {
    time,
    x: (time / timelineDuration) * width,
    width: Math.max(
      1,
      (((audioDuration / timelineDuration) * width) / count) * 0.75,
    ),
  };
}
