import type { DraftId } from "~/composerDraftStore";
import { useComposerDraftStore } from "~/composerDraftStore";
import { resolveEnvironmentMachineKind, type ScopedProjectRef } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import { FolderPlusIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { useClientSettings } from "~/hooks/useSettings";
import { hasExplicitComposerModelSelection } from "~/lib/chatThreadActions";
import { selectProjectGroupingSettings } from "~/logicalProject";
import {
  buildSidebarProjectPickerEntries,
  buildSidebarProjectSnapshots,
  filterSidebarProjectPickerEntries,
  projectGroupsSpanEnvironments,
  type SidebarProjectPickerEntry,
} from "~/sidebarProjectGrouping";
import { useProjects, useThreadShells } from "~/state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { ProjectEnvironmentBadge } from "../ProjectEnvironmentBadge";
import { ProjectFavicon } from "../ProjectFavicon";
import { sortLogicalProjectsForSidebar } from "../Sidebar.logic";
import {
  Combobox,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { Separator } from "../ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

const NEW_PROJECT_ITEM = "__new-project__";

function toProjectPickerItems(entries: ReadonlyArray<SidebarProjectPickerEntry>) {
  return [...entries.map((entry) => entry.group.projectKey), NEW_PROJECT_ITEM];
}

interface DraftHeroHeadlineProps {
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
  readonly activeProjectTitle: string | null;
}

export function DraftHeroHeadline({
  draftId,
  activeProjectRef,
  activeProjectTitle,
}: DraftHeroHeadlineProps) {
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const projectSortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const setLogicalProjectDraftThreadId = useComposerDraftStore(
    (store) => store.setLogicalProjectDraftThreadId,
  );
  const getComposerDraft = useComposerDraftStore((store) => store.getComposerDraft);
  const applyStickyState = useComposerDraftStore((store) => store.applyStickyState);
  const setModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const openAddProject = useCallback(() => openCommandPalette({ open: "add-project" }), []);

  const environmentLabelById = useMemo(
    () =>
      new Map(
        environments.map((environment) => [environment.environmentId, environment.label] as const),
      ),
    [environments],
  );
  const projectGroups = useMemo(
    () =>
      sortLogicalProjectsForSidebar(
        buildSidebarProjectSnapshots({
          projects,
          settings: projectGroupingSettings,
          primaryEnvironmentId,
          resolveEnvironmentLabel: (environmentId) =>
            environmentLabelById.get(environmentId) ?? null,
        }),
        threads,
        projectSortOrder,
      ),
    [
      environmentLabelById,
      primaryEnvironmentId,
      projectGroupingSettings,
      projectSortOrder,
      projects,
      threads,
    ],
  );
  // Same-named projects on two machines are only told apart by where they
  // live, so rows on another machine carry its icon once the catalog spans
  // more than one environment; a single-machine catalog stays as it was.
  const showProjectEnvironments = useMemo(
    () => projectGroupsSpanEnvironments(projectGroups),
    [projectGroups],
  );
  const environmentMachineById = useMemo(
    () =>
      new Map(
        environments.map(
          (environment) =>
            [
              environment.environmentId,
              resolveEnvironmentMachineKind(environment.serverConfig),
            ] as const,
        ),
      ),
    [environments],
  );
  const projectPickerEntries = useMemo(
    () =>
      buildSidebarProjectPickerEntries({
        groups: projectGroups,
        preferredProjectRef: activeProjectRef,
      }),
    [activeProjectRef, projectGroups],
  );
  const projectEntryByKey = useMemo(
    () => new Map(projectPickerEntries.map((entry) => [entry.group.projectKey, entry] as const)),
    [projectPickerEntries],
  );
  const [projectQuery, setProjectQuery] = useState("");
  const filteredProjectPickerEntries = useMemo(
    () => filterSidebarProjectPickerEntries(projectPickerEntries, projectQuery),
    [projectPickerEntries, projectQuery],
  );
  const projectPickerItems = useMemo(
    () => toProjectPickerItems(projectPickerEntries),
    [projectPickerEntries],
  );
  const filteredProjectPickerItems = useMemo(
    () => toProjectPickerItems(filteredProjectPickerEntries),
    [filteredProjectPickerEntries],
  );
  const activeProjectGroup =
    activeProjectRef === null
      ? null
      : (projectGroups.find((group) =>
          group.memberProjectRefs.some(
            (projectRef) => scopedProjectKey(projectRef) === scopedProjectKey(activeProjectRef),
          ),
        ) ?? null);
  const activeProjectKey = activeProjectGroup?.projectKey ?? null;
  const activeProjectDisplayName = activeProjectGroup?.displayName ?? activeProjectTitle;
  const hasResolvedProject = activeProjectTitle !== null;
  const canChooseProject = projectPickerEntries.length > 0;
  const shouldShowProjectMenu = canChooseProject;

  const selectProject = (value: string | null) => {
    if (value === NEW_PROJECT_ITEM) {
      openAddProject();
      return;
    }
    const entry = value === null ? undefined : projectEntryByKey.get(value);
    if (!entry || value === activeProjectKey) {
      return;
    }
    const project = entry.targetProject;
    if (!draftId) {
      return;
    }
    // Project selection changes the target of the open draft in
    // place. The prompt stays in the same composer session, so the
    // sidebar only gets a draft row if the user later navigates away.
    const currentDraft = getComposerDraft(draftId);
    setLogicalProjectDraftThreadId(
      entry.group.projectKey,
      scopeProjectRef(project.environmentId, project.id),
      draftId,
    );
    if (!hasExplicitComposerModelSelection(currentDraft)) {
      applyStickyState(draftId);
      const environmentSettings = environments.find(
        (environment) => environment.environmentId === project.environmentId,
      )?.serverConfig?.settings;
      const defaultModelSelection = environmentSettings
        ? resolveProjectSettings(environmentSettings, project.id, project).settings
            .defaultModelSelection
        : project.defaultModelSelection;
      if (defaultModelSelection) {
        setModelSelection(draftId, defaultModelSelection, {
          replaceOptions: true,
        });
      }
    }
  };

  const projectSelector = shouldShowProjectMenu ? (
    <Combobox
      items={projectPickerItems}
      filteredItems={filteredProjectPickerItems}
      filter={null}
      autoHighlight
      value={activeProjectKey}
      onValueChange={selectProject}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setProjectQuery("");
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            // The trigger's accessible name comes from its visible text (the
            // project title) so the hero sentence reads naturally: an
            // aria-label here would replace the title with an action phrase
            // mid-sentence and baffle screen-reader users.
            <ComboboxTrigger className="pointer-events-auto inline-block max-w-64 truncate border-foreground/60 border-b border-dotted align-baseline text-foreground transition-colors hover:border-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring" />
          }
        >
          {activeProjectDisplayName ?? "Choose a project"}
        </TooltipTrigger>
        {activeProjectDisplayName ? (
          <TooltipPopup side="top" className="max-w-80">
            {activeProjectDisplayName}
          </TooltipPopup>
        ) : null}
      </Tooltip>
      <ComboboxPopup align="center" className="w-72 flex-col">
        <ComboboxSearchInput
          aria-label="Search projects"
          placeholder="Search projects..."
          value={projectQuery}
          onChange={(event) => setProjectQuery(event.target.value)}
        />
        <ComboboxList className="max-h-72">
          {filteredProjectPickerEntries.length === 0 ? (
            <p className="p-2 text-center text-sm text-muted-foreground">No projects found.</p>
          ) : (
            filteredProjectPickerEntries.map(({ group }, index) => (
              <ComboboxItem
                key={group.projectKey}
                index={index}
                value={group.projectKey}
                hideIndicator
                contentClassName="flex min-w-0 items-center gap-2"
              >
                <ProjectFavicon project={group} className="size-4 shrink-0" />
                <Tooltip>
                  <TooltipTrigger render={<span className="block min-w-0 truncate" />}>
                    {group.displayName}
                  </TooltipTrigger>
                  <TooltipPopup side="top" className="max-w-80">
                    {group.displayName}
                  </TooltipPopup>
                </Tooltip>
                {showProjectEnvironments ? (
                  <ProjectEnvironmentBadge
                    group={group}
                    primaryEnvironmentId={primaryEnvironmentId}
                    machineByEnvironmentId={environmentMachineById}
                  />
                ) : null}
              </ComboboxItem>
            ))
          )}
          {filteredProjectPickerEntries.length > 0 ? (
            <Separator className="mx-2 my-1 w-auto" />
          ) : null}
          <ComboboxItem
            index={filteredProjectPickerEntries.length}
            value={NEW_PROJECT_ITEM}
            hideIndicator
            contentClassName="flex min-w-0 items-center gap-2"
          >
            <FolderPlusIcon />
            New project
          </ComboboxItem>
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  ) : (
    <button
      type="button"
      onClick={openAddProject}
      className="pointer-events-auto inline cursor-pointer border-muted-foreground/35 border-b border-dotted text-muted-foreground/60 transition-colors hover:border-muted-foreground/60 hover:text-muted-foreground/80 focus-visible:rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      {activeProjectTitle ?? "Add a project"}
    </button>
  );

  // The composer hero is a sentence, so the heading's accessible name must be
  // a complete sentence too. The project picker is a control rendered inline
  // in the h1; without an explicit label its widget state bleeds into the
  // announced phrase.
  const headingLabel = hasResolvedProject
    ? `What should we build in ${activeProjectDisplayName}?`
    : canChooseProject
      ? `${activeProjectDisplayName ?? "Choose a project"} to start`
      : "Add a project to start";

  return (
    <h1
      aria-label={headingLabel}
      className="mx-auto w-full max-w-5xl text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl"
    >
      {hasResolvedProject ? (
        <>What should we build in {projectSelector}?</>
      ) : canChooseProject ? (
        <>{projectSelector} to start</>
      ) : (
        <>Add a project to start</>
      )}
    </h1>
  );
}
