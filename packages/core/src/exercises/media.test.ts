import { describe, expect, it } from 'vitest';
import { parseExerciseMedia } from './media';

describe('exercise demo media (PRD C2)', () => {
  it('turns YouTube, Vimeo and Instagram links into embeds; an MP4 into a video', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://youtube.com/shorts/dQw4w9WgXcQ',
    ]) {
      expect(parseExerciseMedia(url)).toEqual({
        kind: 'youtube',
        id: 'dQw4w9WgXcQ',
        embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
        thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      });
    }
    expect(parseExerciseMedia('https://vimeo.com/76979871')).toMatchObject({
      kind: 'vimeo',
      embedUrl: 'https://player.vimeo.com/video/76979871?dnt=1',
    });
    expect(parseExerciseMedia('https://www.instagram.com/reel/Cx1abc/')).toMatchObject({
      kind: 'instagram',
      embedUrl: 'https://www.instagram.com/reel/Cx1abc/embed',
    });
    expect(parseExerciseMedia('https://cdn.example.test/squat.MP4')).toMatchObject({
      kind: 'video',
    });
    expect(parseExerciseMedia('https://example.test/how-to')).toMatchObject({ kind: 'link' });
    expect(parseExerciseMedia('http://youtu.be/dQw4w9WgXcQ')).toBeNull();
    expect(parseExerciseMedia('not a url')).toBeNull();
  });
});
