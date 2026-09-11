// A variant is one review/background combination, shared by both placements.
export function reviewAdVariants(reviews, images, mode) {
  const backgrounds = [...new Set(images.filter(Boolean))];
  const selected = backgrounds.length ? (mode === 'rotate' ? backgrounds : backgrounds.slice(0, 1)) : [null];
  return reviews.flatMap(review => selected.map((backgroundImage, imageIndex) => ({
    key: `${review.id}:${imageIndex}`, review, backgroundImage, imageIndex,
  })));
}

export async function addReviewAdPairs(variants, render, save, onProgress = () => {}) {
  let saved = 0;
  for (const variant of variants) {
    onProgress(saved, variants.length);
    const renders = await render(variant, ['square', 'story']);
    if (!renders.square || !renders.story) throw new Error('Both 4:5 and 9:16 must render before saving this ad.');
    const review = variant.review;
    await save({
      id: crypto.randomUUID(), type: 'static',
      squareUrl: renders.square, storyUrl: renders.story,
      name: `HOWL | Review | ${review.nickname || review.handle || 'Customer'} | Image ${variant.imageIndex + 1} | ${String(review.id)}`,
      hook: (review.quote || '').slice(0, 80).trim(), body: '',
    });
    onProgress(++saved, variants.length);
  }
  return saved;
}
