const tf = require('@tensorflow/tfjs');
require('@tensorflow/tfjs-node');
const federated = require('federated-learning-server');
const http = require('http');

const httpServer = http.createServer();

function setupModel() {
  const model = tf.sequential({
    layers: [
      tf.layers.dense({inputShape: [2], units: 4, activation: 'relu'}),
      tf.layers.dense({units: 2, activation: 'relu'}),
    ]
  });
  return model;
}

async function main() {
  const model = setupModel();
  const server = new federated.Server(httpServer, model, {
    clientHyperparams: {learningRate: 3e-4},
    serverHyperparams: {minUpdatesPerVersion: 2},
    modelDir: './models'
  });

  await server.setup();
  httpServer.listen(3000, () => {
    console.log('listening on 3000');
  });
}

main();