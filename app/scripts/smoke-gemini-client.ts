import { callGemini } from '../src/lib/services/geminiClient';

async function main() {
  const response = await callGemini({
    caller: 'smoke_test',
    body: {
      contents: [{ parts: [{ text: 'Say OK.' }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 10 },
    },
  });
  const status = response.status;
  const text = await response.text();
  console.log('status:', status);
  console.log('body:', text.slice(0, 400));
}

main().catch((err) => {
  console.error('smoke failed:', err);
  process.exit(1);
});
