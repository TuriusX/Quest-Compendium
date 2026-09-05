import { GoogleAuth } from 'google-auth-library';
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/datastore'] });

async function findAndUpdateUser() {
  const client = await auth.getClient();
  const projectId = 'gen-lang-client-0366642934';
  const databaseId = 'ai-studio-questcompendium-ee181122-cc9e-4693-a7fd-7ac2ba55dd5f';
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users`;
  
  // Fetch all users to find the one matching the email, or since we just want to update this one user, maybe we can just query by email? Or list all documents and see which has the user. Wait, Firebase auth UID is the document ID. Let's just list documents in users/ collection.
  
  const res = await client.request({ url: url + '?pageSize=100' });
  const docs = (res.data as any).documents || [];
  
  for (const doc of docs) {
    console.log(doc.name);
    if (doc.fields && doc.fields.email && doc.fields.email.stringValue === 'NoahFMinton@gmail.com') {
       console.log('Found user by email field:', doc.name);
       // We can update them.
       // Let's just patch the isPremium field.
       const patchUrl = `https://firestore.googleapis.com/v1/${doc.name}?updateMask=isPremium,subscriptionStatus`;
       const patchRes = await client.request({
         url: patchUrl,
         method: 'PATCH',
         data: {
           name: doc.name,
           fields: {
             isPremium: { booleanValue: false },
             subscriptionStatus: { stringValue: 'inactive' }
           }
         }
       });
       console.log('Updated user:', patchRes.data);
    } else {
        // If they don't have an email field, we might need to just update the one with isPremium true, assuming it's the only one
        if (doc.fields && doc.fields.isPremium && doc.fields.isPremium.booleanValue) {
           console.log('Found premium user without email field:', doc.name);
           const patchUrl = `https://firestore.googleapis.com/v1/${doc.name}?updateMask=isPremium,subscriptionStatus`;
           const patchRes = await client.request({
             url: patchUrl,
             method: 'PATCH',
             data: {
               name: doc.name,
               fields: {
                 isPremium: { booleanValue: false },
                 subscriptionStatus: { stringValue: 'inactive' }
               }
             }
           });
           console.log('Updated user:', patchRes.data);
        }
    }
  }
}

findAndUpdateUser().catch(console.error);
