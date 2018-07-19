/**
 * @license
 * Copyright 2018 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */

import {Server, Socket} from 'socket.io';

// tslint:disable-next-line:max-line-length
import {DataMsg, DownloadMsg, Events, log, serializedToJson, serializeVar, UploadMsg} from './common';
import {ModelDB} from './model_db';

export class ServerAPI {
  modelDB: ModelDB;
  io: Server;
  numClients = 0;

  constructor(
      modelDB: ModelDB, io: Server, private hyperparams: object = null,
      private exitOnClientExit = false) {
    this.modelDB = modelDB;
    this.io = io;
  }

  async setHyperparams(hyperParams: object) {
    this.hyperparams = hyperParams;
    this.io.emit(Events.Download, await this.downloadMsg());
  }

  async downloadMsg(): Promise<DownloadMsg> {
    const varsJson = await this.modelDB.currentVars();
    const varsSeri = await Promise.all(varsJson.map(serializeVar));
    return {
      modelVersion: this.modelDB.modelVersion,
      vars: varsSeri,
      hyperparams: this.hyperparams
    };
  }

  async setup() {
    this.io.on('connection', async (socket: Socket) => {
      socket.on('disconnect', () => {
        this.numClients--;
        log('disconnect', 'numClients:', this.numClients);
        if (this.exitOnClientExit && this.numClients <= 0) {
          this.io.close();
          process.exit(0);
        }
      });

      this.numClients++;
      log('connection', 'numClients:', this.numClients);

      // Send current variables to newly connected client
      const initVars = await this.downloadMsg();
      socket.emit(Events.Download, initVars);

      // Handle data updates (don't expect all clients to use this)
      socket.on(Events.Data, async (msg: DataMsg, ack) => {
        ack(true);
        const input = await serializedToJson(msg.input);
        const target = await serializedToJson(msg.target);
        let output;
        if (msg.output) {
          output = await serializedToJson(msg.output);
        }
        await this.modelDB.putData({
          input,
          target,
          output,
          clientId: socket.client.id,
          modelVersion: msg.modelVersion,
          timestamp: msg.timestamp,
          metadata: msg.metadata
        });
        log('putData', 'clientId:', socket.client.id);
      });

      // When a client sends us updated weights
      socket.on(Events.Upload, async (msg: UploadMsg, ack) => {
        // Immediately acknowledge the request
        ack(true);

        // Save weights
        const updatedVars = await Promise.all(msg.vars.map(serializedToJson));
        const update = {
          clientId: socket.client.id,
          modelVersion: msg.modelVersion,
          numExamples: msg.numExamples,
          vars: updatedVars
        };
        await this.modelDB.putUpdate(update);

        log('putUpdate', 'modelVersion:', msg.modelVersion,
            'clientId:', socket.client.id, 'numExamples:', msg.numExamples);

        // Potentially update the model (asynchronously)
        if (msg.modelVersion === this.modelDB.modelVersion) {
          const updated = await this.modelDB.possiblyUpdate();

          if (updated) {
            // Send new variables to all clients if we updated
            const newVars = await this.downloadMsg();
            this.io.sockets.emit(Events.Download, newVars);

            log('newModel', newVars.modelVersion);
          }
        }
      });
    });
  }
}
