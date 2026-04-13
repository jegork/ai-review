import { App } from "@octokit/app";
import { Octokit } from "octokit";

export async function createAppOctokit(
  appId: string,
  privateKey: string,
  installationId: number,
): Promise<Octokit> {
  const app = new App({ appId, privateKey, Octokit });
  const installationOctokit = await app.getInstallationOctokit(installationId);
  return installationOctokit as unknown as Octokit;
}
