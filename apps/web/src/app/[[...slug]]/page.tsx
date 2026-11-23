import { StandaloneApp } from "../standalone-app";

/**
 * Every page path renders the module, which picks the screen from the URL in
 * the browser. The page itself reads nothing, so it is one static shell.
 */
export default function Page() {
  return <StandaloneApp />;
}
