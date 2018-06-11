import * as tf from '@tensorflow/tfjs';
import {Tensor, Variable} from '@tensorflow/tfjs';
import {LayerVariable} from '@tensorflow/tfjs-layers/dist/variables';

export type SerializedVariable = {
  dtype: tf.DataType,
  shape: number[],
  data: ArrayBuffer
};

export async function serializeVar(variable: tf.Tensor):
    Promise<SerializedVariable> {
  const data = await variable.data();
  // small TypedArrays are views into a larger buffer
  const copy =
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  return {dtype: variable.dtype, shape: variable.shape.slice(), data: copy};
}

export async function serializeVars(
    vars: Array<Variable|LayerVariable|Tensor>) {
  const varsP: Array<Promise<SerializedVariable>> = [];
  vars.forEach((value, key) => {
    if (value instanceof LayerVariable) {
      varsP.push(serializeVar(tf.variable(value.read())));
    } else {
      varsP.push(serializeVar(value));
    }
  });
  return Promise.all(varsP);
}

export function deserializeVar(serialized: SerializedVariable): tf.Tensor {
  const {dtype, shape, data: dataBuffer} = serialized;
  let data;
  // Because socket.io will deserialise JS ArrayBuffers into Nodejs Buffers
  if (dataBuffer instanceof ArrayBuffer) {
    data = dataBuffer;
    // tslint:disable-next-line no-any
  } else if ((dataBuffer as any) instanceof Buffer) {
    // tslint:disable-next-line no-any
    const dataAsBuffer = dataBuffer as any as Buffer;
    data = dataAsBuffer.buffer.slice(
        dataAsBuffer.byteOffset,
        dataAsBuffer.byteOffset + dataAsBuffer.byteLength);
  }
  const numel = shape.reduce((x, y) => x * y, 1);
  const ctor = dtypeToTypedArrayCtor[dtype];
  const array = new ctor(data, 0, numel);
  return tf.tensor(array, shape, dtype);
}

export type TensorJson = {
  values: number[],
  shape: number[],
  dtype?: tf.DataType
};

export function tensorToJson(t: tf.Tensor): TensorJson {
  let data;
  if (t instanceof LayerVariable) {
    data = t.read().dataSync();
  } else {
    data = t.dataSync();
  }
  // Note: could make this async / use base64 encoding on the buffer data
  return {
    'values': Array.from(data), 'shape': t.shape, 'dtype': t.dtype
  }
}

export function jsonToTensor(j: TensorJson): tf.Tensor {
  return tf.tensor(j.values, j.shape, j.dtype || 'float32');
}

export function serializedToJson(serialized: SerializedVariable): TensorJson {
  return tensorToJson(deserializeVar(serialized));
}

export async function jsonToSerialized(j: TensorJson):
    Promise<SerializedVariable> {
  return serializeVar(jsonToTensor(j));
}

const dtypeToTypedArrayCtor = {
  'float32': Float32Array,
  'int32': Int32Array,
  'bool': Uint8Array
};