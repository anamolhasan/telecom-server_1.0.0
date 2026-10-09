---

## description: Deploy the current project to Vercel

# Vercel Deploy

When the user runs `/deploy`, deploy the current project to Vercel.

## Steps

1. Inspect the project before deployment:

   * `git status`
   * `package.json`
   * package manager and lockfile
   * framework configuration
   * `next.config.*` if Next.js
   * `vercel.json` if it exists
   * existing Vercel configuration

2. Detect the project framework and package manager.

3. Check whether the project has a valid production build script.

4. Check required environment variable names from the project configuration.

   * Never print environment variable values.
   * Never expose secrets, tokens, API keys, passwords, or private keys.

5. Run the appropriate production verification:

   * lint if available
   * typecheck if available
   * production build

6. If verification fails:

   * do not deploy
   * identify the root cause
   * fix only deployment-related issues when appropriate
   * run verification again

7. Before deployment:

   * inspect existing Vercel configuration
   * preserve the existing Vercel project
   * preserve the existing Vercel team/scope
   * do not create a new Vercel project unless explicitly requested
   * do not switch Vercel account, team, or scope unless explicitly requested

8. Deploy using the project's existing Vercel configuration.

   Prefer the Vercel CLI when available:

   `vercel deploy --prod`

9. If Vercel CLI is not installed:

   * determine whether the project already has Vercel configuration or an established deployment workflow
   * do not install unrelated dependencies automatically
   * explain what is required before deployment

10. After deployment:

* verify the deployment result
* obtain the deployment URL
* check for obvious deployment errors if possible

## Safety Rules

Never:

* expose secrets or environment variable values
* commit `.env` files
* force push
* delete a Vercel project
* delete production resources
* change production database data
* change Vercel team/scope without explicit user instruction
* create a new Vercel project when an existing project is configured
* blindly retry a failed deployment

## Final Response

Report:

* framework
* package manager
* production build result
* deployment result
* Vercel deployment URL
* any remaining issues

Do not include secret values.
