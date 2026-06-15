const normalize = value => (value || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');

function optionLabel(field, value) {
  const options = field.type_config?.options || [];
  const option = options.find(item =>
    String(item.id) === String(value)
    || String(item.orderindex) === String(value)
    || String(item.name) === String(value)
  );
  return option?.name || option?.label || null;
}

export function decodeClickupField(field) {
  const raw = field?.value;
  if (raw === null || raw === undefined || raw === '') return '';

  if (Array.isArray(raw)) {
    return raw.map(item => {
      if (item && typeof item === 'object') {
        return item.name || item.username || item.email || item.label || item.url || JSON.stringify(item);
      }
      return optionLabel(field, item) || item;
    }).filter(Boolean).join(', ');
  }

  if (raw && typeof raw === 'object') {
    if (raw.location) return [raw.location, raw.formatted_address].filter(Boolean).join(' - ');
    return raw.name || raw.username || raw.email || raw.label || raw.url || raw.formatted_address || JSON.stringify(raw);
  }

  if (field.type === 'date' && Number.isFinite(Number(raw))) {
    const date = new Date(Number(raw));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  if (field.type === 'currency') {
    const currency = field.type_config?.currency_type || field.type_config?.currency || '';
    return currency ? `${currency} ${raw}` : String(raw);
  }

  return optionLabel(field, raw) || String(raw);
}

export function fieldValue(fields, aliases) {
  const wanted = aliases.map(normalize);
  const entries = Object.entries(fields || {});
  for (const [name, value] of entries) {
    if (wanted.includes(normalize(name)) && value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  for (const [name, value] of entries) {
    const normalizedName = normalize(name);
    if (wanted.some(alias => alias.length >= 6 && normalizedName.includes(alias))
      && value !== null && value !== undefined && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

export function extractClickupEmail(task, fields = {}) {
  const named = fieldValue(fields, [
    'email', 'email address', 'creator email', 'applicant email', 'contact email',
    'what is your email', 'what is your email address',
  ]);
  if (named) return named;

  const candidates = [
    task?.email,
    ...Object.values(fields),
    task?.markdown_description,
    task?.description,
  ].filter(Boolean);
  for (const candidate of candidates) {
    const match = String(candidate).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (match) return match[0];
  }
  return '';
}

export function mapClickupStatus(rawStatus) {
  const status = normalize(rawStatus);
  const includes = (...terms) => terms.some(term => status.includes(normalize(term)));
  const mapped = (stage, creatorStatus, mappingKey, confidence = 'high') => ({
    stage,
    status: creatorStatus,
    mapping_key: mappingKey,
    confidence,
  });

  if (includes(
    'reject', 'denied', 'declin', 'disqualif', 'not fit', 'not interested',
    'dont reach out', 'do not reach out', 'ghosted', 'archive', 'cancel',
  )) {
    return mapped('alumni', 'inactive', 'closed_not_moving_forward');
  }
  if (status === 'complete' || includes('alumni', 'past creator', 'offboard', 'completed', 'closed complete')) {
    return mapped('alumni', 'contracted', 'completed_relationship');
  }
  if (includes('active', 'live', 'launched', 'posted', 'approved creator', 'proven creator', 'roster')) {
    return mapped('active', 'contracted', 'active_creator');
  }
  if (includes('produc', 'filming', 'editing', 'creating', 'content in progress', 'awaiting content', 'working')) {
    return mapped('producing', 'contracted', 'in_production');
  }
  if (includes('brief', 'onboard', 'contract', 'negotiat', 'offer sent', 'send product')) {
    return mapped(
      'briefing',
      includes('contract', 'onboard') ? 'contracted' : 'qualified',
      'briefing_and_terms',
    );
  }
  if (includes('interest', 'replied', 'responded', 'qualified', 'approved', 'shortlist', 'interview', 'accepted')) {
    return mapped('interested', 'qualified', 'qualified_creator');
  }
  if (includes('contact', 'outreach', 'reached out', 'follow up', 'emailed', 'messaged')) {
    return mapped('contacted', 'prospect', 'outreach_started');
  }
  if (includes('application submitted', 'submitted', 'teds list', 'ted list', 'new applicant', 'sourced')) {
    return mapped('sourced', 'prospect', 'new_candidate');
  }
  return mapped('sourced', 'prospect', 'needs_review', 'review');
}

function socialProfile(fields, platform) {
  const title = platform === 'instagram' ? 'instagram' : platform === 'tiktok' ? 'tiktok' : 'youtube';
  const raw = fieldValue(fields, [
    title, `${title} handle`, `${title} username`, `${title} profile`, `${title} url`, `${title} link`,
  ]);
  const profileUrl = /^https?:\/\//i.test(raw)
    ? raw
    : raw
      ? `https://www.${title}.com/${raw.replace(/^@/, '')}${title === 'youtube' ? '' : '/'}`
      : '';
  const handle = raw
    ? raw.replace(/^@/, '').replace(/^https?:\/\/(www\.)?[^/]+\//i, '').split(/[/?#]/)[0]
    : '';
  return {
    platform,
    handle,
    profile_url: profileUrl,
    followers: fieldValue(fields, [`${title} followers`, `${title} follower count`, `${title} audience`]),
    avg_views: fieldValue(fields, [`${title} average views`, `${title} avg views`, `${title} views`]),
    engagement_rate: fieldValue(fields, [`${title} engagement`, `${title} engagement rate`, `${title} er`]).replace('%', ''),
  };
}

export function mapClickupCreator(task) {
  const customFields = Object.fromEntries((task.custom_fields || []).map(field => [
    field.name,
    decodeClickupField(field),
  ]));
  const fields = {
    ...customFields,
    Name: task.name,
    Status: task.status?.status || '',
  };
  const pipeline = mapClickupStatus(task.status?.status);
  const notes = task.markdown_description || task.description || fieldValue(fields, [
    'notes', 'application notes', 'additional information', 'anything else',
  ]);
  const socials = ['instagram', 'tiktok', 'youtube']
    .map(platform => socialProfile(fields, platform))
    .filter(account => account.handle || account.profile_url || account.followers);

  return {
    name: fieldValue(fields, ['creator name', 'full name', 'name', 'applicant name']) || task.name,
    email: extractClickupEmail(task, fields),
    phone: fieldValue(fields, ['phone', 'phone number', 'mobile', 'mobile number']),
    location: fieldValue(fields, ['location', 'city', 'city/state', 'state', 'where are you located']),
    timezone: fieldValue(fields, ['timezone', 'time zone']),
    bio: fieldValue(fields, [
      'bio', 'about', 'about you', 'creator bio', 'creator information', 'tell us about yourself',
      'why do you want to work with us', 'content style', 'content niche',
    ]),
    activities: fieldValue(fields, [
      'activities', 'activity', 'interests', 'hobbies', 'outdoor activities', 'sports',
    ]),
    tags: [
      (task.tags || []).map(tag => tag.name).join(', '),
      fieldValue(fields, ['tags', 'labels', 'creator category', 'category', 'niche']),
    ].filter(Boolean).join(', '),
    rate_notes: fieldValue(fields, [
      'rates', 'rate', 'rate card', 'creator rate', 'ugc rate', 'video rate', 'rate per video',
      'pricing', 'cost', 'compensation', 'payment', 'asking rate', 'content rate', 'budget',
    ]),
    avatar_url: fieldValue(fields, ['profile photo', 'headshot', 'avatar', 'photo', 'profile image']),
    notes,
    clickup_status: task.status?.status || '',
    stage: pipeline.stage,
    status: pipeline.status,
    source_metadata: {
      clickup_status: task.status?.status || null,
      clickup_url: task.url || null,
      clickup_mapping_key: pipeline.mapping_key,
      clickup_mapping_confidence: pipeline.confidence,
      clickup_mapped_stage: pipeline.stage,
      clickup_mapped_status: pipeline.status,
      custom_fields: customFields,
    },
    socials,
  };
}
