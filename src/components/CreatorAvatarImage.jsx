import { useEffect, useState } from 'react';

export default function CreatorAvatarImage({ src, className = '', alt = '', children }) {
  const [objectSrc, setObjectSrc] = useState('');
  const [failedSrc, setFailedSrc] = useState('');

  useEffect(() => {
    if (!src || src === failedSrc) {
      setObjectSrc('');
      return undefined;
    }

    let cancelled = false;
    let objectUrl = '';
    setObjectSrc('');

    (async () => {
      try {
        const response = await fetch(`/api/creator-avatar?url=${encodeURIComponent(src)}`);
        if (!response.ok) throw new Error('avatar fetch failed');
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setObjectSrc(objectUrl);
      } catch {
        if (!cancelled) setFailedSrc(src);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src, failedSrc]);

  return objectSrc
    ? <img className={className} src={objectSrc} alt={alt} draggable={false} />
    : children;
}
