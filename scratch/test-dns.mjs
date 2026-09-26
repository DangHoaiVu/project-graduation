import fs from 'fs';
import dns from 'dns/promises';

async function testDns() {
  const regions = ['ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'us-east-1', 'us-west-1', 'eu-central-1'];
  for (const r of regions) {
    const host = `aws-0-${r}.pooler.supabase.com`;
    try {
      const addresses = await dns.lookup(host);
      console.log(`Pooler ${host} resolved:`, addresses.address);
    } catch (e) {
      console.log(`Pooler ${host} failed:`, e.message);
    }
  }
}
testDns();

