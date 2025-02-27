import { Action, AsyncAction } from 'app/overmind';
import getTemplate from '@codesandbox/common/lib/templates';
import slugify from '@codesandbox/common/lib/utils/slugify';
import { withOwnedSandbox } from 'app/overmind/factories';

export const valueChanged: Action<{
  field: string;
  value: string;
}> = ({ state }, { field, value }) => {
  state.workspace.project[field] = value;
};

export const tagChanged: Action<{
  tagName: string;
}> = ({ state }, { tagName }) => {
  state.workspace.tags.tagName = tagName;
};

export const tagAdded: AsyncAction = withOwnedSandbox(
  async ({ state, effects, actions }) => {
    const tagName = state.workspace.tags.tagName;
    const sandbox = state.editor.currentSandbox;

    sandbox.tags.push(tagName);

    try {
      sandbox.tags = await effects.api.createTag(sandbox.id, tagName);

      await actions.editor.internal.updateSandboxPackageJson();
    } catch (error) {
      const index = sandbox.tags.indexOf(tagName);
      sandbox.tags.splice(index, 1);
    }
  }
);

export const tagRemoved: AsyncAction<{
  tag: string;
}> = withOwnedSandbox(async ({ state, effects, actions }, { tag }) => {
  const sandbox = state.editor.currentSandbox;
  const tagIndex = sandbox.tags.indexOf(tag);

  sandbox.tags.splice(tagIndex, 1);

  try {
    sandbox.tags = await effects.api.deleteTag(sandbox.id, tag);

    // Create a "joint action" on this
    const { parsed } = state.editor.parsedConfigurations.package;

    parsed.keywords = sandbox.tags;
    parsed.name = slugify(sandbox.title || sandbox.id);
    parsed.description = sandbox.description;

    const code = JSON.stringify(parsed, null, 2);
    const moduleShortid = state.editor.currentPackageJSON.shortid;

    await actions.editor.internal.saveCode({
      code,
      moduleShortid,
      cbID: null,
    });
  } catch (error) {
    sandbox.tags.splice(tagIndex, 0, tag);
  }
});

export const sandboxInfoUpdated: AsyncAction = withOwnedSandbox(
  async ({ state, effects, actions }) => {
    const sandbox = state.editor.currentSandbox;
    const project = state.workspace.project;

    const hasChangedTitle = project.title && sandbox.title !== project.title;
    const hasChangedDescription =
      project.description && sandbox.description !== project.description;
    const hasChangedAlias = project.alias && sandbox.alias !== project.alias;
    const hasChanged =
      hasChangedTitle || hasChangedDescription || hasChangedAlias;

    if (hasChanged) {
      effects.analytics.track(
        `Sandbox - Update ${
          hasChangedTitle
            ? 'Title'
            : hasChangedDescription
            ? 'Description'
            : 'Alias'
        }`
      );

      sandbox.title = project.title;
      sandbox.description = project.description;
      sandbox.alias = project.alias;

      const updatedSandbox = await effects.api.updateSandbox(sandbox.id, {
        title: project.title,
        description: project.description,
        alias: project.alias,
      });

      effects.router.replaceSandboxUrl(updatedSandbox);

      await actions.editor.internal.updateSandboxPackageJson();
    }
  }
);

export const externalResourceAdded: AsyncAction<{
  resource: string;
}> = withOwnedSandbox(async ({ state, effects, actions }, { resource }) => {
  const externalResources = state.editor.currentSandbox.externalResources;

  externalResources.push(resource);

  try {
    await effects.api.createResource(state.editor.currentId, resource);
  } catch (error) {
    externalResources.splice(externalResources.indexOf(resource), 1);
    effects.notificationToast.error('Could not save external resource');
  }
});

export const externalResourceRemoved: AsyncAction<{
  resource: string;
}> = withOwnedSandbox(async ({ state, effects, actions }, { resource }) => {
  const externalResources = state.editor.currentSandbox.externalResources;
  const resourceIndex = externalResources.indexOf(resource);

  externalResources.splice(resourceIndex, 1);

  try {
    await effects.api.deleteResource(state.editor.currentId, resource);
  } catch (error) {
    externalResources.splice(resourceIndex, 0, resource);
    effects.notificationToast.error(
      'Could not save removal of external resource'
    );
  }
});

export const integrationsOpened: Action = ({ state }) => {
  state.preferences.itemId = 'integrations';
  // I do not think this showModal is used?
  state.preferences.showModal = true;
};

export const sandboxDeleted: AsyncAction = async ({
  state,
  effects,
  actions,
}) => {
  actions.modalClosed();

  await effects.api.deleteSandbox(state.editor.currentId);

  // Not sure if this is in use?
  state.workspace.showDeleteSandboxModal = false;
  effects.notificationToast.success('Sandbox deleted!');

  effects.router.redirectToSandboxWizard();
};

export const sandboxPrivacyChanged: AsyncAction<{
  privacy: 0 | 1 | 2;
}> = async ({ state, effects, actions }, { privacy }) => {
  if (
    getTemplate(state.editor.currentSandbox.template).isServer &&
    privacy === 2
  ) {
    actions.modalOpened({
      modal: 'privacyServerWarning',
      message: null,
    });
  }

  await effects.api.updatePrivacy(state.editor.currentId, privacy);

  state.editor.currentSandbox.privacy = privacy;
};

export const setWorkspaceItem: Action<{
  item: string;
}> = ({ state }, { item }) => {
  state.workspace.openedWorkspaceItem = item;
};

export const toggleCurrentWorkspaceItem: Action = ({ state }) => {
  state.workspace.workspaceHidden = !state.workspace.workspaceHidden;
};

export const setWorkspaceHidden: Action<{ hidden: boolean }> = (
  { state },
  { hidden }
) => {
  state.workspace.workspaceHidden = hidden;
};
