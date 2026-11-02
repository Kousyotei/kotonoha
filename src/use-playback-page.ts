import { useEffect, useRef } from "react";
import { FPS, pageAt, type Project } from "./model";
export function usePlaybackPage(project: Project, frame: number, playing: boolean,
  selected: number, onSelect: (page: number) => void) {
  const previousFrame = useRef(frame);
  const page = pageAt(project, frame / FPS);
  useEffect(() => {
    const moved = frame !== previousFrame.current;
    previousFrame.current = frame;
    if ((playing || moved) && selected !== page) onSelect(page);
    // While paused, edits to page timings alone must not switch the form.
  }, [frame, playing, page, selected, onSelect]);
}
