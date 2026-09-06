import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, CLEANUP_MODES } from '../app/services/ai-cleaner.server.js';
test('text replacement preserves literal multilingual strings without cleanup instructions', () => {
 const prompt=buildPrompt(CLEANUP_MODES.edit_text, '', {originalText:'SALE',replacementText:'夏季特惠'});
 assert.ok(prompt.includes('"SALE"'));assert.ok(prompt.includes('"夏季特惠"'));
 assert.ok(!prompt.includes('Remove all visible text'));
});
test('custom edits preserve the instruction and require meaningful input', () => {
 const instruction='把背景换成米色，保留瓶子和标签';
 assert.ok(buildPrompt(CLEANUP_MODES.custom,'',{editInstructions:instruction}).includes(instruction));
 assert.throws(()=>buildPrompt(CLEANUP_MODES.custom,'',{editInstructions:'  '}));
 assert.throws(()=>buildPrompt(CLEANUP_MODES.edit_text,'',{}));
});
