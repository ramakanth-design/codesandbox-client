import { Socket } from 'phoenix';
import _debug from '@codesandbox/common/lib/utils/debug';
import uuid from 'uuid';
import { TextOperation } from 'ot';
import { camelizeKeys } from 'humps';
import {
  Module,
  Directory,
  RoomInfo,
  Sandbox,
} from '@codesandbox/common/lib/types';
import { getTextOperation } from '@codesandbox/common/lib/utils/diff';
import clientsFactory from './clients';

type Options = {
  onApplyOperation(args: { moduleShortid: string; operation: any }): void;
  provideJwtToken(): string;
};

type JoinChannelResponse = {
  sandboxId: string;
  sandbox: Sandbox;
  moduleState: object;
  liveUserId: string;
  roomInfo: RoomInfo;
};

declare global {
  interface Window {
    socket: any;
  }
}

const identifier = uuid.v4();
const sentMessages = new Map();
const debug = _debug('cs:socket');

let channel = null;
let messageIndex = 0;
let clients: ReturnType<typeof clientsFactory>;
let _socket: Socket = null;
let provideJwtToken = null;

export default {
  initialize(options: Options) {
    const live = this;

    clients = clientsFactory(
      (moduleShortid, revision, operation) => {
        live.send('operation', {
          moduleShortid,
          operation,
          revision,
        });
      },
      (moduleShortid, operation) => {
        options.onApplyOperation({
          moduleShortid,
          operation,
        });
      }
    );
    provideJwtToken = options.provideJwtToken;
  },
  getSocket() {
    return _socket || this.connect();
  },
  connect() {
    if (!_socket) {
      _socket = new Socket(`wss://${location.host}/socket`, {
        params: {
          guardian_token: provideJwtToken(),
        },
      });

      _socket.connect();
      window.socket = _socket;
      debug('Connecting to socket', _socket);
    }

    return _socket;
  },
  disconnect() {
    return new Promise((resolve, reject) => {
      channel
        .leave()
        .receive('ok', resp => {
          channel.onMessage = d => d;
          channel = null;
          sentMessages.clear();
          messageIndex = 0;

          return resolve(resp);
        })
        .receive('error', resp => reject(resp));
    });
  },
  joinChannel(roomId: string): Promise<JoinChannelResponse> {
    channel = this.getSocket().channel(`live:${roomId}`, {});

    return new Promise((resolve, reject) => {
      channel
        .join()
        .receive('ok', resp =>
          resolve(camelizeKeys(resp) as JoinChannelResponse)
        )
        .receive('error', resp => reject(camelizeKeys(resp)));
    });
  },
  // TODO: Need to take an action here
  listen(
    action: (payload: {
      event: string;
      _isOwnMessage: boolean;
      data: object;
    }) => {}
  ) {
    channel.onMessage = (event: any, data: any) => {
      const disconnected = data == null && event === 'phx_error';
      const alteredEvent = disconnected ? 'connection-loss' : event;

      const _isOwnMessage = Boolean(
        data && data._messageId && sentMessages.delete(data._messageId)
      );

      action({
        event: alteredEvent,
        _isOwnMessage,
        data: data == null ? {} : data,
      });

      return data;
    };
  },
  send(event: string, payload: { _messageId?: string; [key: string]: any }) {
    const _messageId = identifier + messageIndex++;
    // eslint-disable-next-line
    payload._messageId = _messageId;
    sentMessages.set(_messageId, payload);

    return new Promise((resolve, reject) => {
      if (channel) {
        channel
          .push(event, payload)
          .receive('ok', resolve)
          .receive('error', reject);
      } else {
        reject('Channel is not defined');
      }
    });
  },
  sendModuleUpdate(module: Module) {
    return this.send('module:updated', {
      type: 'module',
      moduleShortid: module.shortid,
      module,
    });
  },
  sendDirectoryUpdate(directory: Directory) {
    return this.send('directory:updated', {
      type: 'directory',
      directoryShortid: directory.shortid,
      module: directory,
    });
  },
  sendCodeUpdate(moduleShortid: string, currentCode: string, code: string) {
    const operation = getTextOperation(currentCode, code);

    if (!operation) {
      return;
    }

    try {
      clients.get(moduleShortid).applyClient(TextOperation.fromJSON(operation));
    } catch (e) {
      // Something went wrong, probably a sync mismatch. Request new version
      console.error(
        'Something went wrong with applying OT operation',
        moduleShortid,
        operation
      );
      this.send('live:module_state', {});
    }
  },
  sendUserCurrentModule(moduleShortid: string) {
    this.send('user:current-module', {
      moduleShortid,
    });
  },
  sendDirectoryCreated(directory: Directory) {
    this.send('directory:created', {
      type: 'directory',
      module: directory,
    });
  },
  sendDirectoryDeleted(directoryShortid: string) {
    this.send('directory:deleted', {
      type: 'directory',
      directoryShortid,
    });
  },
  sendModuleCreated(module: Module) {
    this.send('module:created', {
      type: 'module',
      moduleShortid: module.shortid,
      module,
    });
  },
  sendModuleDeleted(moduleShortid: string) {
    this.send('module:deleted', {
      type: 'module',
      moduleShortid,
    });
  },
  sendMassCreatedModules(modules: Module[], directories: Directory[]) {
    this.send('module:mass-created', {
      directories,
      modules,
    });
  },
  sendLiveMode(mode: string) {
    this.send('live:mode', {
      mode,
    });
  },
  sendEditorAdded(liveUserId: string) {
    this.send('live:add-editor', {
      editor_user_id: liveUserId,
    });
  },
  sendEditorRemoved(liveUserId: string) {
    this.send('live:remove-editor', {
      editor_user_id: liveUserId,
    });
  },
  sendClosed() {
    this.send('live:close', {});
  },
  sendChat(message: string) {
    this.send('chat', {
      message,
    });
  },
  sendModuleSaved(moduleShortid: string) {
    this.send('module:saved', {
      type: 'module',
      moduleShortid,
    });
  },
  sendChatEnabled(enabled: boolean) {
    this.send('live:chat_enabled', { enabled });
  },
  sendModuleUpdateRequest() {
    this.send('live:module_state', {});
  },
  sendUserSelection(moduleShortid: string, liveUserId: string, selection: any) {
    this.send('user:selection', {
      liveUserId,
      moduleShortid,
      selection,
    });
  },
  getAllClients() {
    return clients.getAll();
  },
  getClient(moduleShortid: string) {
    return clients.get(moduleShortid);
  },
  createClient(moduleShortid: string, revision: number) {
    return clients.create(moduleShortid, revision);
  },
  resetClients() {
    clients.clear();
  },
};
