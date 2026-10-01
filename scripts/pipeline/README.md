# Guide pipeline

Keeps the guides growing on its own: finds games worth a guide, builds, upgrades and translates them inside a
monthly budget, rebuilds the website, deploys it to Netlify, and posts a summary to Discord. The logic is in
`run.ts` (read its header for what it does and every setting).

## Try it on your PC first

    npx tsx scripts/pipeline/run.ts --dry-run     # shows what it would do, changes nothing
    npx tsx scripts/pipeline/run.ts               # does it (without NETLIFY_* set, it rebuilds the site but doesn't deploy)

## Run it in Google Cloud, once a day

It runs as a Cloud Run **job** (a task that starts, works and stops) built from this repo, started daily by
Cloud Scheduler.

1. Deploy the job (same project and region as the server). Give it the same `GEMINI_API_KEY` the server uses, plus
   the Netlify and Discord settings:

       gcloud run jobs deploy guide-pipeline --source . --region us-east1 --project quest-compendium-1bccf \
         --command npx --args tsx,scripts/pipeline/run.ts \
         --task-timeout 3h --max-retries 0 --memory 2Gi \
         --set-env-vars GEMINI_API_KEY=…,NETLIFY_AUTH_TOKEN=…,NETLIFY_SITE_ID=…,DISCORD_WEBHOOK_URL=…

2. Schedule it daily (9:00 Central here), using a service account allowed to run Cloud Run jobs:

       gcloud scheduler jobs create http guide-pipeline-daily --location us-east1 --project quest-compendium-1bccf \
         --schedule "0 9 * * *" --time-zone "America/Chicago" \
         --uri "https://run.googleapis.com/v2/projects/quest-compendium-1bccf/locations/us-east1/jobs/guide-pipeline:run" \
         --http-method POST --oauth-service-account-email <service-account-email>

3. Run it once by hand to check: `gcloud run jobs execute guide-pipeline --region us-east1 --project quest-compendium-1bccf`

## Things to know

- **The website comes from the job's copy of this repo.** The job rebuilds the guide pages from Firestore, but the
  homepage and other site files are whatever was in the repo when the job was last deployed. After changing the
  website, redeploy the job (step 1) so it doesn't put an older homepage back.
- **Budget:** `PIPELINE_MONTHLY_AI_DOLLARS` (default $10) and `PIPELINE_MONTHLY_SEARCHES` (default 1,500), and it always
  leaves `PIPELINE_PLAYER_RESERVE` (default 2,000) of the app's monthly searches for players. Change them with
  `gcloud run jobs update guide-pipeline --update-env-vars …`.
- **Off switch:** set `enabled` to `false` on the `system/pipeline` document in Firestore. The month's totals and the
  last report are on that document too.
