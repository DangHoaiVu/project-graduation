import { getLearningArtifacts } from './lib/learning-artifacts.js';

async function test() {
  const artifacts = await getLearningArtifacts({ limit: 20 });
  console.log('Artifacts:', artifacts);
}
test().catch(console.error);

