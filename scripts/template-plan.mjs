/**
 * template-plan.mjs — decides what `npm run templates:create` will send,
 * without sending it.
 *
 * Credly checks a new template's fields when it is created and answers a
 * problem with a 422. Everything it is documented to check is checked here
 * first, so a mistake costs a local error message rather than a request,
 * and every problem is reported at once rather than one per attempt.
 *
 * Unknown fields in the file are errors, not passengers. A misspelt field
 * name (`skill` for `skills`, `criteria` for `badge_template_activities`)
 * would otherwise be dropped silently, and the template created without it.
 *
 * Nothing in this module makes a request.
 */

// Credly's activity types, from the API reference. `Badge` means "requires
// another badge first" and needs `required_badge_template_id`.
export const ACTIVITY_TYPES = [
  'Application', 'Assessment', 'Award', 'Badge', 'Course', 'Credential',
  'Education Experience', 'Leadership', 'Member', 'Other', 'Participant',
  'Payment', 'Portfolio', 'Presenter', 'Project', 'Professional Experience',
  'Schedule / Registration', 'Volunteer'
];

const ENUMS = {
  state: ['active', 'draft'],
  level: ['Foundational', 'Intermediate', 'Advanced', 'N/A'],
  type_category: ['Experience', 'Learning', 'Validation', 'Certification', 'Recognition', 'Membership', 'N/A'],
  time_to_earn: ['Hours', 'Days', 'Weeks', 'Months', 'Years', 'N/A'],
  cost: ['Free', 'Paid', 'N/A']
};

// The fields a template file may set. A deliberately short list: the ones a
// first template needs, plus the classification fields shown on the badge.
// Add to it when a field is needed, and check its shape in the reference.
const STRING_FIELDS = ['name', 'description', 'global_activity_url', 'earn_this_badge_url'];
const BOOLEAN_FIELDS = ['public', 'allow_duplicate_badges'];
export const TEMPLATE_FIELDS = [
  ...STRING_FIELDS,
  ...BOOLEAN_FIELDS,
  ...Object.keys(ENUMS),
  'skills',
  'badge_template_activities',
  'image_url'
];

const ACTIVITY_FIELDS = ['activity_type', 'title', 'activity_url', 'required_badge_template_id'];

export const MIN_SKILLS = 3;
export const MAX_DESCRIPTION = 500;
export const MIN_IMAGE_SIDE = 600;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Reads a PNG's dimensions from its header, or returns null if the bytes are
 * not a PNG. The first chunk of every PNG is IHDR, and its first eight bytes
 * are the width and height, so there is no need for an image library.
 */
export function pngSize(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24) return null;
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** Problems with a local image file, as Credly states its requirements. */
export function checkImage(bytes) {
  const size = pngSize(bytes);
  if (!size) return ['the image is not a PNG file. Credly accepts PNG only'];
  if (size.width < MIN_IMAGE_SIDE || size.height < MIN_IMAGE_SIDE) {
    return [`the image is ${size.width}×${size.height}. Credly needs at least ${MIN_IMAGE_SIDE}×${MIN_IMAGE_SIDE}`];
  }
  return [];
}

const isUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

/**
 * Validates a parsed template file and builds the request body.
 *
 * `image` is the bytes of a local PNG, or undefined when the file gives an
 * `image_url` instead. Exactly one of the two is needed. A local image is
 * sent base64-encoded with its data-type prefix, which is the form the
 * reference documents.
 *
 * Returns `{ payload, problems }`. `payload` is null whenever `problems` is
 * not empty.
 */
export function planTemplate(file, { image } = {}) {
  const problems = [];
  if (!file || typeof file !== 'object' || Array.isArray(file)) {
    return { payload: null, problems: ['the file must hold a single JSON object'] };
  }

  for (const key of Object.keys(file)) {
    if (!TEMPLATE_FIELDS.includes(key)) problems.push(`unknown field "${key}"`);
  }

  for (const key of STRING_FIELDS) {
    if (file[key] !== undefined && typeof file[key] !== 'string') problems.push(`${key} must be a string`);
  }
  for (const key of BOOLEAN_FIELDS) {
    if (file[key] !== undefined && typeof file[key] !== 'boolean') problems.push(`${key} must be true or false`);
  }
  for (const [key, allowed] of Object.entries(ENUMS)) {
    if (file[key] !== undefined && !allowed.includes(file[key])) {
      problems.push(`${key} is "${file[key]}". It must be one of: ${allowed.join(', ')}`);
    }
  }

  if (!file.name?.trim?.()) problems.push('missing name');
  if (!file.description?.trim?.()) problems.push('missing description');
  else if (file.description.length > MAX_DESCRIPTION) {
    problems.push(`description is ${file.description.length} characters. Credly allows ${MAX_DESCRIPTION}`);
  }
  for (const key of ['global_activity_url', 'earn_this_badge_url', 'image_url']) {
    if (file[key] !== undefined && !isUrl(file[key])) problems.push(`${key} "${file[key]}" is not a URL`);
  }

  const skills = file.skills;
  if (!Array.isArray(skills) || skills.some((s) => typeof s !== 'string' || !s.trim())) {
    problems.push(`skills must be a list of at least ${MIN_SKILLS} names`);
  } else {
    const distinct = new Set(skills.map((s) => s.trim().toLowerCase()));
    if (distinct.size < MIN_SKILLS) {
      problems.push(`skills has ${distinct.size} distinct ${distinct.size === 1 ? 'entry' : 'entries'}. Credly needs at least ${MIN_SKILLS}`);
    }
  }

  const activities = file.badge_template_activities;
  if (!Array.isArray(activities) || !activities.length) {
    problems.push('badge_template_activities (the earning criteria) must list at least one activity');
  } else {
    activities.forEach((a, i) => {
      const at = `badge_template_activities[${i}]`;
      if (!a || typeof a !== 'object') return problems.push(`${at} must be an object`);
      for (const key of Object.keys(a)) {
        if (!ACTIVITY_FIELDS.includes(key)) problems.push(`${at} has unknown field "${key}"`);
      }
      if (!a.title?.trim?.()) problems.push(`${at} is missing title`);
      else if (a.title.length > 500) problems.push(`${at} title is over 500 characters`);
      if (!ACTIVITY_TYPES.includes(a.activity_type)) {
        problems.push(`${at} activity_type is "${a.activity_type ?? ''}". It must be one of: ${ACTIVITY_TYPES.join(', ')}`);
      }
      if (a.activity_type === 'Badge' && !a.required_badge_template_id) {
        problems.push(`${at} is a Badge activity, so it needs required_badge_template_id`);
      }
      if (a.activity_url !== undefined && !isUrl(a.activity_url)) {
        problems.push(`${at} activity_url "${a.activity_url}" is not a URL`);
      }
    });
  }

  if (image && file.image_url) problems.push('give the image as --image or as image_url, not both');
  else if (!image && !file.image_url) problems.push('missing image: pass --image <file.png>, or set image_url');
  else if (image) problems.push(...checkImage(image));

  if (problems.length) return { payload: null, problems };

  const { image_url, ...fields } = file;
  const payload = {
    ...fields,
    name: file.name.trim(),
    skills: skills.map((s) => s.trim()),
    image: {
      remote_upload_url: image ? `data:image/png;base64,${image.toString('base64')}` : image_url
    }
  };
  return { payload, problems: [] };
}

/**
 * Compares the template Credly returns with what was sent. A 201 says the
 * request was accepted; this says the template is what was asked for.
 *
 * Returns a list of mismatches; empty means verified. Skills are compared as
 * sets of names, since Credly returns them as objects and may reorder them.
 */
export function verifyTemplate(payload, created) {
  const mismatches = [];
  if (!created) return ['the new template could not be read back'];
  if (created.name !== payload.name) mismatches.push(`name is "${created.name}", expected "${payload.name}"`);
  if (payload.state && created.state !== payload.state) {
    mismatches.push(`state is ${created.state}, expected ${payload.state}`);
  }
  const names = (list) => new Set((list || []).map((s) => (typeof s === 'string' ? s : s?.name ?? '').toLowerCase()));
  const want = names(payload.skills);
  const got = names(created.skills);
  const missing = [...want].filter((s) => !got.has(s));
  if (missing.length) mismatches.push(`skills missing: ${missing.join(', ')}`);
  if (!created.image_url && !created.image?.url) mismatches.push('the template has no image');
  return mismatches;
}
