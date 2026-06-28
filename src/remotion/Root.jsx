import React from 'react';
import { Composition } from 'remotion';
import { UgcVideo } from './UgcVideo';

const defaultSegments = [{ start: 0, end: 12 }];

export function RemotionRoot() {
  return (
    <Composition
      id="UgcAd"
      component={UgcVideo}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        videoSrc: '',
        segments: defaultSegments,
        words: [],
        showCaptions: true,
        captionStyle: 'pop',
        showIntro: true,
        showOutro: true,
        intro: {
          title: 'HOWL',
          subtitle: "World's hottest smokeless fire pit",
        },
        outro: {
          headline: 'Feel the heat.',
          cta: 'howlcampfires.com',
        },
      }}
    />
  );
}
