import { unsigned } from '../utils/varint.js'
import type { FieldDef, FieldDefs } from '../index.js'
import { DecodeFunction, EncodeFunction, createCodec, EncodingLengthFunction, Codec, CODEC_TYPES } from './codec.js'
import { Uint8ArrayList } from 'uint8arraylist'

export interface Factory<A, T> {
  new (obj: A): T
}

export function message <T> (fieldDefs: FieldDefs): Codec<T> {
  const encodingLength: EncodingLengthFunction<T> = function messageEncodingLength (val: Record<string, any>) {
    let length = 0

    for (const fieldDef of Object.values(fieldDefs)) {
      length += fieldDef.codec.encodingLength(val[fieldDef.name])
    }

    return unsigned.encodingLength(length) + length
  }

  const encode: EncodeFunction<Record<string, any>> = function messageEncode (val) {
    const bytes = new Uint8ArrayList()

    function encodeValue (value: any, fieldNumber: number, fieldDef: FieldDef) {
      if (value == null) {
        if (fieldDef.optional === true) {
          return
        }

        throw new Error(`Non optional field "${fieldDef.name}" was ${value === null ? 'null' : 'undefined'}`)
      }

      const key = (fieldNumber << 3) | fieldDef.codec.type
      const prefix = new Uint8Array(unsigned.encodingLength(key))
      unsigned.encode(key, prefix)
      const encoded = fieldDef.codec.encode(value)

      bytes.append(prefix)
      bytes.append(encoded)
    }

    for (const [fieldNumberStr, fieldDef] of Object.entries(fieldDefs)) {
      const fieldNumber = parseInt(fieldNumberStr)

      if (fieldDef.repeats === true) {
        if (!Array.isArray(val[fieldDef.name])) {
          throw new Error(`Repeating field "${fieldDef.name}" was not an array`)
        }

        for (const value of val[fieldDef.name]) {
          encodeValue(value, fieldNumber, fieldDef)
        }
      } else {
        encodeValue(val[fieldDef.name], fieldNumber, fieldDef)
      }
    }

    const prefix = new Uint8Array(unsigned.encodingLength(bytes.length))
    unsigned.encode(bytes.length, prefix)

    return new Uint8ArrayList(prefix, bytes)
  }

  const decode: DecodeFunction<T> = function messageDecode (buffer, offset) {
    const length = unsigned.decode(buffer, offset)
    offset += unsigned.encodingLength(length)

    const fields: any = {}

    while (offset < buffer.length) {
      // console.info('start offset', offset)

      const key = unsigned.decode(buffer, offset)
      offset += unsigned.encodingLength(key)

      const wireType = key & 0x7
      const fieldNumber = key >> 3
      const fieldDef = fieldDefs[fieldNumber]
      let fieldLength = 0

      // console.info('fieldNumber', fieldNumber, 'wireType', wireType, 'offset', offset)

      if (wireType === CODEC_TYPES.VARINT) {
        // console.info('decode varint')
        if (fieldDef != null) {
          // use the codec if it is available as this could be a bigint
          const value = fieldDef.codec.decode(buffer, offset)
          fieldLength = fieldDef.codec.encodingLength(value)
        } else {
          const value = unsigned.decode(buffer, offset)
          fieldLength = unsigned.encodingLength(value)
        }
      } else if (wireType === CODEC_TYPES.BIT64) {
        // console.info('decode 64bit')
        fieldLength = 8
      } else if (wireType === CODEC_TYPES.LENGTH_DELIMITED) {
        // console.info('decode length delimited')
        const valueLength = unsigned.decode(buffer, offset)
        fieldLength = valueLength + unsigned.encodingLength(valueLength)
      } else if (wireType === CODEC_TYPES.BIT32) {
        // console.info('decode 32 bit')
        fieldLength = 4
      } else if (wireType === CODEC_TYPES.START_GROUP) {
        throw new Error('Unsupported wire type START_GROUP')
      } else if (wireType === CODEC_TYPES.END_GROUP) {
        throw new Error('Unsupported wire type END_GROUP')
      }

      // console.info('fieldLength', fieldLength)

      if (fieldDef != null) {
        // console.info('decode', fieldDef.codec.name, fieldDef.name, 'at offset', offset)
        const value = fieldDef.codec.decode(buffer, offset)

        if (fieldDef.repeats === true) {
          if (fields[fieldDef.name] == null) {
            fields[fieldDef.name] = []
          }

          fields[fieldDef.name].push(value)
        } else {
          fields[fieldDef.name] = value
        }

        // console.info('decoded', value)
      }

      offset += fieldLength
    }

    // make sure repeated fields have an array if not set
    for (const fieldDef of Object.values(fieldDefs)) {
      if (fieldDef.repeats === true && fields[fieldDef.name] == null) {
        fields[fieldDef.name] = []
      }
    }

    return fields
  }

  return createCodec('message', CODEC_TYPES.LENGTH_DELIMITED, encode, decode, encodingLength)
}
