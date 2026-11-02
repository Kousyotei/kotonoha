import React from "react";
import { Composition, registerRoot } from "remotion";
import { Video } from "./Video";
import { duration, FPS, initialProject } from "./model";
registerRoot(() => (
  <Composition
    id="Reading"
    component={Video}
    width={1920}
    height={1080}
    fps={FPS}
    durationInFrames={300}
    defaultProps={{ project: initialProject }}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.ceil(duration(props.project) * FPS),
    })}
  />
));
