import { useId, useState } from 'react';
import './CreatorTagInput.css';

export function normalizeCreatorTags(values) {
  const seen = new Set();
  return values.flatMap(value => String(value).split(',')).map(value => value.trim().slice(0, 100)).filter(value => {
    const key = value.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

export default function CreatorTagInput({ value = [], onChange, disabled = false, suggestions = [] }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const tags = normalizeCreatorTags(value);
  const commit = (text = draft) => {
    onChange(normalizeCreatorTags([...tags, text]));
    setDraft('');
  };
  return <div className="creator-tag-field">
    <label htmlFor={id}>Creator tags</label>
    <div className="creator-tag-editor">
      {tags.map(tag => <span className="creator-tag-chip" key={tag.toLowerCase()}>{tag}
        {!disabled && <button type="button" aria-label={`Remove tag ${tag}`} onClick={() => onChange(tags.filter(item => item !== tag))}>×</button>}
      </span>)}
      <input id={id} disabled={disabled} value={draft} placeholder={tags.length ? 'Add another tag…' : 'Type a tag…'}
        aria-describedby={`${id}-hint`} onChange={event => setDraft(event.target.value)} onBlur={() => draft.trim() && commit()}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); commit(); }
          if (event.key === 'Backspace' && !draft) onChange(tags.slice(0, -1));
        }} />
    </div>
    {!disabled && <small id={`${id}-hint`}>Press Enter or comma to add. Use your own tags.</small>}
    {!disabled && suggestions.length > 0 && <div className="creator-tag-suggestions" aria-label="Suggested creator tags">
      {suggestions.filter(tag => !tags.some(item => item.toLowerCase() === tag.toLowerCase())).slice(0, 6).map(tag =>
        <button type="button" key={tag} onClick={() => commit(tag)}>+ {tag}</button>)}
    </div>}
  </div>;
}
