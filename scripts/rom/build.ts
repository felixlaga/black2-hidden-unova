import { NintendoDSRom } from "../../vendor/pokeweb-serverless/src/nds/rom";
import { compareTextArchives, type ApprovedTextChange } from "../dialogue-guard";
import { formatAddedDialogue } from "./dialogue";

export type DialogueApproval = ApprovedTextChange & { archive: "messages" | "story" };

/** Assemble the campaign in dependency order. Never writes the base or exports a ROM. */
export async function applyExpansion(rom: NintendoDSRom, options: { fixtureWithoutAccess?: boolean } = {}) {
  const beforeText = new Map([
    ["messages", new Uint8Array(rom.getFileByName("a/0/0/2"))],
    ["story", new Uint8Array(rom.getFileByName("a/0/0/3"))],
  ]);
  const trainersModule = await import("./trainers");
  const campaignModule = await import("./campaign");
  const routeTrainersModule = await import("./route-trainers");
  const worldModule = await import("./world");
  const speciesModule = await import("./species");
  const storyModule = await import("./story");
  const accessModule = options.fixtureWithoutAccess ? undefined : await import("./access");
  const epilogueModule = await import("./epilogue");
  const climaxModule = await import("./climax");
  const trainers = trainersModule.applyTrainers(rom, {
    profile: "full-campaign", gymAceLevels: campaignModule.ORIGINAL_GYM_ACE_LEVELS,
  });
  const campaign = campaignModule.applyCampaignDefinitions(rom);
  const routeTrainers = routeTrainersModule.applyRouteTrainerDefinitions(rom, campaign);
  const accessPreparation = accessModule?.prepareCampaignAccess(campaign) ?? { fixtureOnly: true, nativeAccessMigrationOmitted: true };
  const world = worldModule.applyWorld(rom, { campaign, routeTrainers });
  const species = speciesModule.applySpecies(rom, world);
  const story = storyModule.applyStory(rom, world, trainers, campaign);
  const access = accessModule?.applyAccess(rom) ?? { fixtureOnly: true, nativeAccessMigrationOmitted: true };
  const epilogue = epilogueModule.applyEpilogue(rom, world);
  const climax = climaxModule.applyClimax(rom, world, species);
  const reports = { trainers, campaign, routeTrainers, world, species, story, access, accessPreparation, epilogue, climax };
  const rawApprovals: DialogueApproval[] = Object.values(reports).flatMap(
    report => (report as { approvedDialogueChanges?: DialogueApproval[] }).approvedDialogueChanges ?? [],
  );
  const dialogueLayout = formatAddedDialogue(rom, beforeText, rawApprovals);
  const approvedDialogueChanges = dialogueLayout.approvedDialogueChanges;
  const modules = { ...reports, dialogueLayout };
  const dialogue = ([['messages', 'a/0/0/2'], ['story', 'a/0/0/3']] as const).map(([archive, path]) => ({
    archive, ...compareTextArchives(beforeText.get(archive)!, rom.getFileByName(path),
      approvedDialogueChanges.filter(change => change.archive === archive)),
  }));
  for (const result of dialogue) {
    if (result.differences.length || result.unusedApprovals.length) {
      throw new Error(`Original ${result.archive} text preservation failed: ${JSON.stringify(result)}`);
    }
  }
  return { modules, approvedDialogueChanges, dialogue };
}
