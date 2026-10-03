# Guide pipeline

Keeps the guides growing on its own: finds games worth a guide, builds, upgrades and translates them inside a
monthly budget, rebuilds the website, deploys it to Netlify, and posts a summary to Discord. The logic is in
`run.ts` (read its header for what it does and every setting).

## Try it on your PC first

    npx tsx scripts/pipeline/run.ts --dry-run     # shows what it would do, changes nothing
    npx tsx scripts/pipeline/run.ts               # does it (without NETLIFY_* set, it rebuilds the site but doesn't deploy)

## Run it in Google Cloud, once a day

It runs as a Cloud Run **job** (a task that starts, works and stops) started daily by Cloud Scheduler. The job has
its own image (`scripts/pipeline/Dockerfile`: the repo's scripts and website with production dependencies), because the
server's image only holds the built app.

1. Build the job image (from the repo root):

       gcloud builds submit --config scripts/pipeline/cloudbuild.yaml --project quest-compendium-1bccf .

2. The keys live in Secret Manager (not in the job's plain settings): `gemini-api-key` (the same key the server uses),
   `netlify-auth-token` and `discord-webhook-url`. The job's service account needs the Secret Accessor role on them.

3. Deploy the job (same project and region as the server):

       gcloud run jobs deploy guide-pipeline --image us-east1-docker.pkg.dev/quest-compendium-1bccf/cloud-run-source-deploy/guide-pipeline:latest \
         --region us-east1 --project quest-compendium-1bccf \
         --task-timeout 3h --max-retries 0 --memory 2Gi \
         --set-env-vars NETLIFY_SITE_ID=… \
         --set-secrets GEMINI_API_KEY=gemini-api-key:latest,NETLIFY_AUTH_TOKEN=netlify-auth-token:latest,DISCORD_WEBHOOK_URL=discord-webhook-url:latest

4. Schedule it daily (9:00 Central here), using a service account allowed to run Cloud Run jobs:

       gcloud scheduler jobs create http guide-pipeline-daily --location us-east1 --project quest-compendium-1bccf \
         --schedule "0 9 * * *" --time-zone "America/Chicago" \
         --uri "https://run.googleapis.com/v2/projects/quest-compendium-1bccf/locations/us-east1/jobs/guide-pipeline:run" \
         --http-method POST --oauth-service-account-email <service-account-email>

5. Run it once by hand to check: `gcloud run jobs execute guide-pipeline --region us-east1 --project quest-compendium-1bccf`

## Things to know

- **The website comes from the job's copy of this repo.** The job rebuilds the guide pages from Firestore, but the
  homepage and other site files are whatever was in the repo when the job image was last built. After changing the
  website, rebuild the image (step 1) and redeploy the job (step 3) so it doesn't put an older homepage back.
- **Steam picks:** only RPG/adventure games with at least `PIPELINE_MIN_STEAM_REVIEWS` Steam reviews (default 2,000)
  count, so small new games don't use up the month's searches.
- **Budget:** `PIPELINE_MONTHLY_AI_DOLLARS` (default $10) and `PIPELINE_MONTHLY_SEARCHES` (default 1,500), and it always
  leaves `PIPELINE_PLAYER_RESERVE` (default 2,000) of the app's monthly searches for players. Change them with
  `gcloud run jobs update guide-pipeline --update-env-vars …`.
  - **Set since 2026-10-03, to finish the guide-review rebuilds quickly:** `MONTHLY_SEARCH_CAP=8500` on both the job
    and the server (`gcloud run services update quest-compendium --update-env-vars …`; searches past the free 5,000 a
    month cost $14 per 1,000), `PIPELINE_MONTHLY_AI_DOLLARS=15` and `PIPELINE_QUEUE_MINUTES=160`. The pipeline still
    stops 2,000 below the cap (the player reserve), so it may use up to 6,500 searches a month app-wide. The cap stays
    at 8,500 into later months until it's set back to 5000 on both.
- **Off switch:** set `enabled` to `false` on the `system/pipeline` document in Firestore. The month's totals and the
  last report are on that document too.
