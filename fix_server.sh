#!/bin/bash
# Remove firebase-admin/firestore
sed -i '/import { getFirestore } from '"'"'firebase-admin\/firestore'"'"';/d' server.ts

# Define the rest api helpers
cat << 'REST_HELPERS' > rest_helpers.ts
async function getFirestoreDocREST(idToken: string, uid: string) {
  const projectId = 'gen-lang-client-0366642934';
  const databaseId = 'ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f';
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${uid}`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${idToken}` } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Firestore read error: ${await response.text()}`);
  const data = await response.json();
  const parsed: any = {};
  if (data.fields) {
    for (const [k, v] of Object.entries(data.fields)) {
      parsed[k] = (v as any).stringValue ?? (v as any).booleanValue ?? (v as any).integerValue;
      if (parsed[k] !== undefined && (v as any).integerValue !== undefined) {
         parsed[k] = parseInt((v as any).integerValue, 10);
      }
    }
  }
  return parsed;
}

async function updateFirestoreDocREST(idToken: string, uid: string, fields: Record<string, any>) {
  const projectId = 'gen-lang-client-0366642934';
  const databaseId = 'ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f';
  const mask = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${uid}?${mask}`;
  
  const firestoreFields: any = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'boolean') firestoreFields[k] = { booleanValue: v };
    else if (typeof v === 'number') firestoreFields[k] = { integerValue: v };
    else if (typeof v === 'string') firestoreFields[k] = { stringValue: v };
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: firestoreFields })
  });
  if (!response.ok) throw new Error(`Firestore write error: ${await response.text()}`);
}
REST_HELPERS

