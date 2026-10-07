import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { planTemplate, verifyTemplate, pngSize, checkImage } from '../scripts/template-plan.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(root, 'examples', 'badge-template.json'), 'utf8'));

/** The first 24 bytes of a PNG: the signature, then the IHDR chunk's header. */
function pngHeader(width, height) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}
const IMAGE = pngHeader(600, 600);

test('the example file is a valid template', () => {
  const { payload, problems } = planTemplate(EXAMPLE, { image: IMAGE });
  assert.deepEqual(problems, []);
  assert.equal(payload.name, 'credjar test badge');
  assert.equal(payload.state, 'active');
  assert.match(payload.image.remote_upload_url, /^data:image\/png;base64,/);
  // The image goes in as `image`, never as a top-level image_url.
  assert.equal(payload.image_url, undefined);
});

test('an image URL can stand in for a local file', () => {
  const { payload, problems } = planTemplate({ ...EXAMPLE, image_url: 'https://cdn.example.com/b.png' });
  assert.deepEqual(problems, []);
  assert.equal(payload.image.remote_upload_url, 'https://cdn.example.com/b.png');
  assert.equal(payload.image_url, undefined);
});

test('pngSize reads dimensions, and rejects what is not a PNG', () => {
  assert.deepEqual(pngSize(pngHeader(800, 640)), { width: 800, height: 640 });
  assert.equal(pngSize(Buffer.from('GIF89a, definitely not a png file at all')), null);
  assert.equal(pngSize(Buffer.alloc(4)), null);
});

test('Credly\'s image rules are checked locally', () => {
  assert.deepEqual(checkImage(IMAGE), []);
  assert.match(checkImage(pngHeader(599, 600))[0], /599×600.*at least 600×600/);
  assert.match(checkImage(Buffer.from('\xff\xd8\xff a jpeg')).join(), /not a PNG/);
});

test('every missing requirement is reported at once', () => {
  const { payload, problems } = planTemplate({}, {});
  assert.equal(payload, null);
  const all = problems.join('\n');
  for (const want of [/missing name/, /missing description/, /skills must be a list/, /at least one activity/, /missing image/]) {
    assert.match(all, want);
  }
});

// A misspelt field would otherwise be dropped, and the template created
// without it.
test('unknown fields are errors, at the top level and in criteria', () => {
  const { problems } = planTemplate(
    {
      ...EXAMPLE,
      skill: ['oops'],
      badge_template_activities: [{ activity_type: 'Course', title: 'x', url: 'https://x.example' }]
    },
    { image: IMAGE }
  );
  assert.ok(problems.includes('unknown field "skill"'));
  assert.ok(problems.includes('badge_template_activities[0] has unknown field "url"'));
});

test('fewer than three distinct skills is refused', () => {
  const { problems } = planTemplate({ ...EXAMPLE, skills: ['A', 'a', 'B'] }, { image: IMAGE });
  assert.match(problems.join(), /2 distinct entries. Credly needs at least 3/);
});

test('field values are checked against what Credly accepts', () => {
  const { problems } = planTemplate(
    {
      ...EXAMPLE,
      description: 'x'.repeat(501),
      state: 'archived',
      level: 'Expert',
      public: 'yes',
      global_activity_url: 'not a url',
      badge_template_activities: [{ activity_type: 'Webinar', title: '' }, { activity_type: 'Badge', title: 'Needs another' }]
    },
    { image: IMAGE }
  );
  const all = problems.join('\n');
  assert.match(all, /description is 501 characters/);
  assert.match(all, /state is "archived"/);
  assert.match(all, /level is "Expert"/);
  assert.match(all, /public must be true or false/);
  assert.match(all, /global_activity_url "not a url" is not a URL/);
  assert.match(all, /\[0\] is missing title/);
  assert.match(all, /\[0\] activity_type is "Webinar"/);
  assert.match(all, /\[1\] is a Badge activity, so it needs required_badge_template_id/);
});

test('an image both ways is refused', () => {
  const { problems } = planTemplate({ ...EXAMPLE, image_url: 'https://x.example/b.png' }, { image: IMAGE });
  assert.match(problems.join(), /not both/);
});

test('verifyTemplate accepts a faithful read-back, with skills as objects in any order', () => {
  const { payload } = planTemplate(EXAMPLE, { image: IMAGE });
  const created = {
    name: payload.name,
    state: 'active',
    skills: [{ name: 'automation' }, { name: 'Testing' }, { name: 'Credly API' }],
    image_url: 'https://images.example/x.png'
  };
  assert.deepEqual(verifyTemplate(payload, created), []);
});

test('verifyTemplate reports what differs', () => {
  const { payload } = planTemplate(EXAMPLE, { image: IMAGE });
  const mismatches = verifyTemplate(payload, { name: 'Other', state: 'draft', skills: [{ name: 'Testing' }] });
  const all = mismatches.join('\n');
  assert.match(all, /name is "Other"/);
  assert.match(all, /state is draft, expected active/);
  assert.match(all, /skills missing: credly api, automation/);
  assert.match(all, /no image/);
  assert.deepEqual(verifyTemplate(payload, null), ['the new template could not be read back']);
});
