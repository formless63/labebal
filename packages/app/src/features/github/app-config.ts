/**
 * The labebal GitHub App ("Connect GitHub", github.com/apps/labebal).
 * `LABEBAL_GITHUB_CLIENT_ID` and `LABEBAL_GITHUB_APP_SLUG` override these for
 * self-hosted installs that register their own App (docs/DEPLOY.md "GitHub");
 * an empty client id hides the "Connect GitHub" button (tokens only).
 *
 * The client id is public (GitHub shows it on github.com/login/device); no
 * client secret is needed or used anywhere (device flow, user-token
 * expiration off).
 */
export const GITHUB_APP_CLIENT_ID_DEFAULT = "Iv23licwijxvaX2N90lh";
/** The App's URL name: github.com/apps/<slug>. */
export const GITHUB_APP_SLUG_DEFAULT = "labebal";
