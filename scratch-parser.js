 
var ScratchReader = (function ScratchReaderClosure() {
  function ScratchReader() {}

  ScratchReader.prototype = {
    loadFile: function ScratchReader_loadFile(path, callback) {
      var reader = this;

      var request = new XMLHttpRequest();
      request.open('GET', path, true);
      request.overrideMimeType('text/plain; charset=x-user-defined');
      request.responseType = 'arraybuffer';
      request.onreadystatechange = function() {
        if (request.readyState == 4) {
          var buffer = request.response;
          if (buffer == null) {
            callback(null, 'Cannot read the file: ' + path);
            return;
          }
          try {
            var data = new Uint8Array(buffer);
            var model = reader.parseData(data);
            callback(model);
          } catch (e) {
            callback(null, 'Error during data parsing: ' + e);
          }
        }
      };
      request.send(null);
    },
    parseData: function ScratchReader_parseData(data) {
      function readFields(reader, fieldsCount) {
        var fields = [];
        for (var i = 0; i < fieldsCount; i++) {
          var object = readObject(reader);
          fields.push(object);
        }
        return fields;
      }
      function readObject(reader) {
        var classId = reader.readByte();
        if (classId >= 100) {
          var constructor = ScratchObjectProxies[classId];
          if (!constructor)
            throw 'Unsuppored user defined object: ' + classId;
          var version = reader.readByte();
          var fieldsCount = reader.readByte();
          var fields = readFields(reader, fieldsCount);
          return new constructor(classId, version, fields);
        }

        switch (classId) {
          case 1: // Null
            return null;
          case 2: // True
            return true;
          case 3: // False
            return false;
          case 4: // Int
            return reader.readInt32();
          case 5: // Short
            var n = ((reader.readByte() << 24) | (reader.readByte() << 16)) >> 16;
            return n;
          case 8: // Double
            var floatData = reader.readBytes(8);
            // XXX reversing float bytes for network order?
            var reversedFloatData = new Uint8Array(8);
            for (var i = 0, j = 7; j >= 0; i++, j--)
               reversedFloatData[i] = floatData[j];
            return (new Float64Array(reversedFloatData.buffer))[0];
          case 9: // String
            var charsCount = reader.readInt32();
            var str = reader.readString(charsCount); // XXX adjust for mac encoding ???
            return str;
          case 10: // Symbol
            var charsCount = reader.readInt32();
            var str = reader.readString(charsCount);
            return new ScratchSymbol(str);
          case 11: // Bytes
            var bytesCount = reader.readInt32();
            return reader.readBytes(bytesCount);
          case 12: // SoundBuffer
            var samplesCount = reader.readInt32();
            return new SoundBuffer(reader.readBytes(samplesCount * 2));
          case 14: // UTF-8 string
            var charsCount = reader.readInt32();
            var str = reader.readString(charsCount);
            return decodeURIComponent(escape(str));
          case 20: // Array
          case 21: // OrderedCollection
          case 22: // Set
          case 23: // IdentitySet
            var itemsCount = reader.readInt32();
            var fields = readFields(reader, itemsCount);
            return new ScratchArray(classId, fields);
          case 24: // Dictionary
          case 25: // IdentityDictionary
            var itemsCount = reader.readInt32();
            var fields = readFields(reader, itemsCount * 2);
            return new ScratchDictionary(classId, fields);
          case 30: // Color
            var color = reader.readInt32();
            return new ScratchColor((color >> 22) & 0xFF, (color >> 12) & 0xFF,
                                    (color >> 2) & 0xFF);
          case 31: // TranslucentColor
            var color = reader.readInt32();
            var alpha = reader.readByte();
            return new ScratchColor((color >> 22) & 0xFF, (color >> 12) & 0xFF,
                                    (color >> 2) & 0xFF, alpha);
          case 32: // Point
            var fields = readFields(reader, 2);
            return new ScratchPoint(fields[0], fields[1]);
          case 33: // Rectangle
            var fields = readFields(reader, 4);
            return new ScratchRectangle(fields[0], fields[1], fields[2], fields[3]);
          case 34: // Form
            var fields = readFields(reader, 5);
            return new ScratchForm(fields);
          case 35: // ColorForm
            var fields = readFields(reader, 6);
            return new ScratchColorForm(fields);
          case 99: // Reference
            return new ScratchReference(
              (reader.readByte() << 16) | (reader.readByte() << 8) | reader.readByte()
            );
          default:
            throw 'Unknown object class: ' + classId;
        }
      }
      function readObjectStore(reader, end) {
        var storeTag = reader.readString(10);
        if (storeTag != 'ObjS\x01Stch\x01')
          throw 'Invalid object store tag';
        // read objects
        var objects = [];
        ScratchReference.currentStoreObjects = objects;
        var objectsCount = reader.readInt32();
        for (var i = 0; i < objectsCount; i++) {
          var object = readObject(reader);
          if (i in objects && objects[i] instanceof ScratchObjectPromise)
            objects[i].resolve(object);
          objects[i] = object;
        }
        ScratchReference.currentStoreObjects = null;
        return objects[0]; // we just need root object
      }

      var reader = {
        position: 0,
        end: data.length,
        data: data,
        readBytes: function reader_readBytes(length) {
          var start = this.position;
          var end = (this.position += length);
          var array = this.data.subarray(start, end);
          return array;
        },
        readString: function reader_readString(length) {
          var s = '';
          var data = this.data, position = this.position;
          for (var i = 0; i < length; i++)
            s += String.fromCharCode(data[position++]);
          this.position = position;
          return s;
        },
        readInt32: function reader_readInt32() {
          var data = this.data, position = this.position;
          var n = (data[position] << 24) | (data[position + 1] << 16) |
                  (data[position + 2] << 8) | data[position + 3];
          this.position += 4;
          return n;
        },
        readByte: function reader_readByte() {
          return this.data[this.position++];
        }
      };

      var model = {};
      // reading the top-level structure
      var header = {};
      var headerTag = reader.readString(10);
      if (headerTag != 'ScratchV01' && headerTag != 'ScratchV02')
        throw 'Invalid file tag';
      header.tag = headerTag;
      
      model.header = header;
      var infoSize = reader.readInt32();

      model.info = readObjectStore(reader, reader.position + infoSize);
      
      model.contents = readObjectStore(reader, reader.end);
      return model;
    }
  };

  return ScratchReader;
})();

function ScratchObjectPromise() {
  this.tasks = [];
}
ScratchObjectPromise.prototype = Object.create(null, {
  addTask: {
    value: function(obj, name) {
      this.tasks.push({obj: obj, name: name});
    }
  },
  resolve: {
    value: function(value) {
      for (var i = 0; i < this.tasks.length; i++) {
        var task = this.tasks[i];
        task.obj[task.name] = value;
      }
      delete this.tasks;
    }
  }
});

function ScratchReference(ref) {
  this.ref = ref;
}
ScratchReference.currentStoreObjects = null;

function assignDelayedObject(obj, name, value) {
  if (!(value instanceof ScratchReference)) {
    obj[name] = value;
    return;
  }
  var objectIndex = value.ref - 1;
  var promise;
  if (!(objectIndex in ScratchReference.currentStoreObjects))
    ScratchReference.currentStoreObjects[objectIndex] = promise = new ScratchObjectPromise();
  else
    promise = ScratchReference.currentStoreObjects[objectIndex];

  if (!(promise instanceof ScratchObjectPromise)) {
    obj[name] = promise; // already resolved
    return;
  }
  promise.addTask(obj, name);  
}

function ensurePrimitive(value) {
  if (value instanceof ScratchReference)
    throw 'Value is a reference';
  return value;
}

function ScratchSymbol(s) {
  this.symbol = s;
}

function SoundBuffer(data) {
  this.data = data;
}

function ScratchObject(classId, version) {
  if (arguments.length === 0) return;

  this.classId = classId;
  this.version = version;
}

function Morph(classId, version, fields) {
  if (arguments.length === 0) return;
  ScratchObject.apply(this, arguments);

  assignDelayedObject(this, 'bounds', fields[0]);
  assignDelayedObject(this, 'owner', fields[1]);
  assignDelayedObject(this, 'submorphs', fields[2]);
  assignDelayedObject(this, 'color', fields[3]);
  assignDelayedObject(this, 'flags', fields[4]);
}
ScratchMedia.prototype = Object.create(new ScratchObject)

function ScratchMedia(classId, version, fields) {
  if (arguments.length === 0) return;
  ScratchObject.apply(this, arguments);

  assignDelayedObject(this, 'mediaName', fields[0]);
}
ScratchMedia.prototype = Object.create(new ScratchObject);

function ScriptableScratchMorph(classId, version, fields) {
  if (arguments.length === 0) return;
  Morph.apply(this, arguments);

  assignDelayedObject(this, 'objName', fields[6]);
  assignDelayedObject(this, 'vars', fields[7]);
  assignDelayedObject(this, 'blocksBin', fields[8]);
  assignDelayedObject(this, 'isClone', fields[9]);
  assignDelayedObject(this, 'media', fields[10]);
  assignDelayedObject(this, 'costume', fields[11]);
}
ScriptableScratchMorph.prototype = Object.create(new Morph);

function ScratchStageMorph(classId, version, fields) {
  if (arguments.length === 0) return;
  ScriptableScratchMorph.apply(this, arguments);

  assignDelayedObject(this, 'zoom', fields[12]);
  assignDelayedObject(this, 'hPan', fields[13]);
  assignDelayedObject(this, 'vPan', fields[14]);
  assignDelayedObject(this, 'obsoleteSavedState', fields[15]);
  assignDelayedObject(this, 'sprites', fields[16]);
  assignDelayedObject(this, 'volume', fields[17]);
  assignDelayedObject(this, 'tempoBPM', fields[18]);
  assignDelayedObject(this, 'sceneStates', fields[19]);
  assignDelayedObject(this, 'lists', fields[20]);
}
ScratchStageMorph.prototype = Object.create(new ScriptableScratchMorph);

function ScratchSpriteMorph(classId, version, fields) {
  if (arguments.length === 0) return;
  ScriptableScratchMorph.apply(this, arguments);

  assignDelayedObject(this, 'visibility', fields[12]);
  assignDelayedObject(this, 'scalePoint', fields[13]);
  assignDelayedObject(this, 'rotationDegrees', fields[14]);
  assignDelayedObject(this, 'rotationStyle', fields[15]);
  assignDelayedObject(this, 'volume', fields[16]);
  assignDelayedObject(this, 'tempoBPM', fields[17]);
  assignDelayedObject(this, 'draggable', fields[18]);
  assignDelayedObject(this, 'sceneStates', fields[19]);
  assignDelayedObject(this, 'lists', fields[20]);
}
ScratchSpriteMorph.prototype = Object.create(new ScriptableScratchMorph);

function ImageMedia(classId, version, fields) {
  if (arguments.length === 0) return;
  ScratchMedia.apply(this, arguments);

  assignDelayedObject(this, 'form', fields[1]);
  assignDelayedObject(this, 'rotationCenter', fields[2]);
  assignDelayedObject(this, 'textBox', fields[3]);
  assignDelayedObject(this, 'jpegBytes', fields[4]);
  assignDelayedObject(this, 'compositeForm', fields[5]);
}
ImageMedia.prototype = Object.create(new ScratchMedia);

function SoundMedia(classId, version, fields) {
  if (arguments.length === 0) return;
  ScratchMedia.apply(this, arguments);

  assignDelayedObject(this, 'originalSound', fields[1]);
  assignDelayedObject(this, 'volume', fields[2]);
  assignDelayedObject(this, 'balance', fields[3]);
  assignDelayedObject(this, 'compressedSampleRate', fields[4]);
  assignDelayedObject(this, 'compressedBitsPerSample', fields[5]);
  assignDelayedObject(this, 'compressedData', fields[6]);
}
SoundMedia.prototype = Object.create(new ScratchMedia);

function ScratchArray(classId, fields) {
  this.classId = classId;
  var items = [];
  for (var i = 0; i < fields.length; i++)
    assignDelayedObject(items, i, fields[i]);
  this.items = items;

  return items; // Making it as a regular array
}

function ScratchDictionary(classId, pairs) {
  this.classId = classId;
  var keys = [], values = [];
  for (var i = 0, j = 0; i < pairs.length; i += 2, j++) {
    assignDelayedObject(keys, j, pairs[i]);
    assignDelayedObject(values, j, pairs[i + 1]);
  }
  this.keys = keys;
  this.values = values;
}
ScratchDictionary.prototype = Object.create(null, {
  forEach: {
    value: function(fn) {
      for (var i = 0; i < this.keys.length; i++)
        fn(this.keys[i], this.values[i]);
    },
    enumerable: false
  },
  lookup: {
    value: function(key) {
      for (var i = 0; i < this.keys.length; i++) {
        if (key == this.keys[i])
          return this.values[i];
      }
    },
    enumerable: false
  }
});

function ScratchColor(r, g, b, a) {
  this.r = ensurePrimitive(r);
  this.b = ensurePrimitive(b);
  this.g = ensurePrimitive(g);
  this.a = arguments.length > 3 ? ensurePrimitive(a) : 255;
}

function ScratchPoint(x, y) {
  this.x = ensurePrimitive(x);
  this.y = ensurePrimitive(y);
}

function ScratchRectangle(x1, y1, x2, y2) {
  this.x1 = ensurePrimitive(x1);
  this.y1 = ensurePrimitive(y1);
  this.x2 = ensurePrimitive(x2);
  this.y2 = ensurePrimitive(y2);
}
ScratchRectangle.prototype = Object.create(null, {
  offset: {
    value: function ScratchRectangle_offset(dx, dy) {
      this.x1 += dx;
      this.y1 += dy;
      this.x2 += dx;
      this.y2 += dy;
    }
  }
});

function ScratchForm(fields) {
  if (arguments.length === 0) return;

  this.width = ensurePrimitive(fields[0]);
  this.height = ensurePrimitive(fields[1]);
  this.depth = ensurePrimitive(fields[2]);
  assignDelayedObject(this, 'offset', fields[3]);
  assignDelayedObject(this, 'data', fields[4]);
}
ScratchForm.prototype = Object.create(null, {
  getPixels: {
    value: function ScratchForm_getPixels() {
      var data = this.data;

      var j = 0;
      function readNumber() {
        var b = data[j++];
        if (b <= 223)
          return b;
        if (b <= 254)
          return ((b - 224) << 8) | data[j++];
        var n = (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3];
        j += 4;
        return n;
      }

      var length = readNumber();
      var pixels = new Int32Array(length);
      var i = 0;
      while (i < length && j < data.length) {
        var header = readNumber();
        var blockLength = (header >>> 2);
        switch (header & 3) {
          case 0: // running 0
            i += blockLength;
            break;
          case 1: // running quad
            var quad = data[j++];
            quad |= (quad << 24) | (quad << 16) | (quad << 8);
            for (var q = 0; q < blockLength; q++)
              pixels[i++] = quad;
            break;
          case 2: // running int
            var n = (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3];
            j += 4;
            for (var q = 0; q < blockLength; q++)
              pixels[i++] = n;
            break;
          case 3: // copy
            for (var q = 0; q < blockLength; q++, j += 4)
              pixels[i++] = (data[j] << 24) | (data[j + 1] << 16) | (data[j + 2] << 8) | data[j + 3];
            break;
        }
      }
      return pixels; 
    }
  },
  colors: {
    value: [new ScratchColor(255, 255, 255),
      new ScratchColor(0, 0, 0), new ScratchColor(255, 255, 255),
      new ScratchColor(128, 128, 128), new ScratchColor(255, 0, 0),
      new ScratchColor(0, 255, 0), new ScratchColor(0, 0, 255),
      new ScratchColor(0, 255, 255), new ScratchColor(255, 255, 0),
      new ScratchColor(255, 0, 255), new ScratchColor(32, 32, 32),
      new ScratchColor(64, 64, 64), new ScratchColor(96, 96, 96),
      new ScratchColor(159, 159, 159), new ScratchColor(191, 191, 191),
      new ScratchColor(223, 223, 223), new ScratchColor(8, 8, 8),
      new ScratchColor(16, 16, 16), new ScratchColor(24, 24, 24),
      new ScratchColor(40, 40, 40), new ScratchColor(48, 48, 48),
      new ScratchColor(56, 56, 56), new ScratchColor(72, 72, 72),
      new ScratchColor(80, 80, 80), new ScratchColor(88, 88, 88),
      new ScratchColor(104, 104, 104), new ScratchColor(112, 112, 112),
      new ScratchColor(120, 120, 120), new ScratchColor(135, 135, 135),
      new ScratchColor(143, 143, 143), new ScratchColor(151, 151, 151),
      new ScratchColor(167, 167, 167), new ScratchColor(175, 175, 175),
      new ScratchColor(183, 183, 183), new ScratchColor(199, 199, 199),
      new ScratchColor(207, 207, 207), new ScratchColor(215, 215, 215),
      new ScratchColor(231, 231, 231), new ScratchColor(239, 239, 239),
      new ScratchColor(247, 247, 247), new ScratchColor(0, 0, 0),
      new ScratchColor(0, 51, 0), new ScratchColor(0, 102, 0),
      new ScratchColor(0, 153, 0), new ScratchColor(0, 204, 0),
      new ScratchColor(0, 255, 0), new ScratchColor(0, 0, 51),
      new ScratchColor(0, 51, 51), new ScratchColor(0, 102, 51),
      new ScratchColor(0, 153, 51), new ScratchColor(0, 204, 51),
      new ScratchColor(0, 255, 51), new ScratchColor(0, 0, 102),
      new ScratchColor(0, 51, 102), new ScratchColor(0, 102, 102),
      new ScratchColor(0, 153, 102), new ScratchColor(0, 204, 102),
      new ScratchColor(0, 255, 102), new ScratchColor(0, 0, 153),
      new ScratchColor(0, 51, 153), new ScratchColor(0, 102, 153),
      new ScratchColor(0, 153, 153), new ScratchColor(0, 204, 153),
      new ScratchColor(0, 255, 153), new ScratchColor(0, 0, 204),
      new ScratchColor(0, 51, 204), new ScratchColor(0, 102, 204),
      new ScratchColor(0, 153, 204), new ScratchColor(0, 204, 204),
      new ScratchColor(0, 255, 204), new ScratchColor(0, 0, 255),
      new ScratchColor(0, 51, 255), new ScratchColor(0, 102, 255),
      new ScratchColor(0, 153, 255), new ScratchColor(0, 204, 255),
      new ScratchColor(0, 255, 255), new ScratchColor(51, 0, 0),
      new ScratchColor(51, 51, 0), new ScratchColor(51, 102, 0),
      new ScratchColor(51, 153, 0), new ScratchColor(51, 204, 0),
      new ScratchColor(51, 255, 0), new ScratchColor(51, 0, 51),
      new ScratchColor(51, 51, 51), new ScratchColor(51, 102, 51),
      new ScratchColor(51, 153, 51), new ScratchColor(51, 204, 51),
      new ScratchColor(51, 255, 51), new ScratchColor(51, 0, 102),
      new ScratchColor(51, 51, 102), new ScratchColor(51, 102, 102),
      new ScratchColor(51, 153, 102), new ScratchColor(51, 204, 102),
      new ScratchColor(51, 255, 102), new ScratchColor(51, 0, 153),
      new ScratchColor(51, 51, 153), new ScratchColor(51, 102, 153),
      new ScratchColor(51, 153, 153), new ScratchColor(51, 204, 153),
      new ScratchColor(51, 255, 153), new ScratchColor(51, 0, 204),
      new ScratchColor(51, 51, 204), new ScratchColor(51, 102, 204),
      new ScratchColor(51, 153, 204), new ScratchColor(51, 204, 204),
      new ScratchColor(51, 255, 204), new ScratchColor(51, 0, 255),
      new ScratchColor(51, 51, 255), new ScratchColor(51, 102, 255),
      new ScratchColor(51, 153, 255), new ScratchColor(51, 204, 255),
      new ScratchColor(51, 255, 255), new ScratchColor(102, 0, 0),
      new ScratchColor(102, 51, 0), new ScratchColor(102, 102, 0),
      new ScratchColor(102, 153, 0), new ScratchColor(102, 204, 0),
      new ScratchColor(102, 255, 0), new ScratchColor(102, 0, 51),
      new ScratchColor(102, 51, 51), new ScratchColor(102, 102, 51),
      new ScratchColor(102, 153, 51), new ScratchColor(102, 204, 51),
      new ScratchColor(102, 255, 51), new ScratchColor(102, 0, 102),
      new ScratchColor(102, 51, 102), new ScratchColor(102, 102, 102),
      new ScratchColor(102, 153, 102), new ScratchColor(102, 204, 102),
      new ScratchColor(102, 255, 102), new ScratchColor(102, 0, 153),
      new ScratchColor(102, 51, 153), new ScratchColor(102, 102, 153),
      new ScratchColor(102, 153, 153), new ScratchColor(102, 204, 153),
      new ScratchColor(102, 255, 153), new ScratchColor(102, 0, 204),
      new ScratchColor(102, 51, 204), new ScratchColor(102, 102, 204),
      new ScratchColor(102, 153, 204), new ScratchColor(102, 204, 204),
      new ScratchColor(102, 255, 204), new ScratchColor(102, 0, 255),
      new ScratchColor(102, 51, 255), new ScratchColor(102, 102, 255),
      new ScratchColor(102, 153, 255), new ScratchColor(102, 204, 255),
      new ScratchColor(102, 255, 255), new ScratchColor(153, 0, 0),
      new ScratchColor(153, 51, 0), new ScratchColor(153, 102, 0),
      new ScratchColor(153, 153, 0), new ScratchColor(153, 204, 0),
      new ScratchColor(153, 255, 0), new ScratchColor(153, 0, 51),
      new ScratchColor(153, 51, 51), new ScratchColor(153, 102, 51),
      new ScratchColor(153, 153, 51), new ScratchColor(153, 204, 51),
      new ScratchColor(153, 255, 51), new ScratchColor(153, 0, 102),
      new ScratchColor(153, 51, 102), new ScratchColor(153, 102, 102),
      new ScratchColor(153, 153, 102), new ScratchColor(153, 204, 102),
      new ScratchColor(153, 255, 102), new ScratchColor(153, 0, 153),
      new ScratchColor(153, 51, 153), new ScratchColor(153, 102, 153),
      new ScratchColor(153, 153, 153), new ScratchColor(153, 204, 153),
      new ScratchColor(153, 255, 153), new ScratchColor(153, 0, 204),
      new ScratchColor(153, 51, 204), new ScratchColor(153, 102, 204),
      new ScratchColor(153, 153, 204), new ScratchColor(153, 204, 204),
      new ScratchColor(153, 255, 204), new ScratchColor(153, 0, 255),
      new ScratchColor(153, 51, 255), new ScratchColor(153, 102, 255),
      new ScratchColor(153, 153, 255), new ScratchColor(153, 204, 255),
      new ScratchColor(153, 255, 255), new ScratchColor(204, 0, 0),
      new ScratchColor(204, 51, 0), new ScratchColor(204, 102, 0),
      new ScratchColor(204, 153, 0), new ScratchColor(204, 204, 0),
      new ScratchColor(204, 255, 0), new ScratchColor(204, 0, 51),
      new ScratchColor(204, 51, 51), new ScratchColor(204, 102, 51),
      new ScratchColor(204, 153, 51), new ScratchColor(204, 204, 51),
      new ScratchColor(204, 255, 51), new ScratchColor(204, 0, 102),
      new ScratchColor(204, 51, 102), new ScratchColor(204, 102, 102),
      new ScratchColor(204, 153, 102), new ScratchColor(204, 204, 102),
      new ScratchColor(204, 255, 102), new ScratchColor(204, 0, 153),
      new ScratchColor(204, 51, 153), new ScratchColor(204, 102, 153),
      new ScratchColor(204, 153, 153), new ScratchColor(204, 204, 153),
      new ScratchColor(204, 255, 153), new ScratchColor(204, 0, 204),
      new ScratchColor(204, 51, 204), new ScratchColor(204, 102, 204),
      new ScratchColor(204, 153, 204), new ScratchColor(204, 204, 204),
      new ScratchColor(204, 255, 204), new ScratchColor(204, 0, 255),
      new ScratchColor(204, 51, 255), new ScratchColor(204, 102, 255),
      new ScratchColor(204, 153, 255), new ScratchColor(204, 204, 255),
      new ScratchColor(204, 255, 255), new ScratchColor(255, 0, 0),
      new ScratchColor(255, 51, 0), new ScratchColor(255, 102, 0),
      new ScratchColor(255, 153, 0), new ScratchColor(255, 204, 0),
      new ScratchColor(255, 255, 0), new ScratchColor(255, 0, 51),
      new ScratchColor(255, 51, 51), new ScratchColor(255, 102, 51),
      new ScratchColor(255, 153, 51), new ScratchColor(255, 204, 51),
      new ScratchColor(255, 255, 51), new ScratchColor(255, 0, 102),
      new ScratchColor(255, 51, 102), new ScratchColor(255, 102, 102),
      new ScratchColor(255, 153, 102), new ScratchColor(255, 204, 102),
      new ScratchColor(255, 255, 102), new ScratchColor(255, 0, 153),
      new ScratchColor(255, 51, 153), new ScratchColor(255, 102, 153),
      new ScratchColor(255, 153, 153), new ScratchColor(255, 204, 153),
      new ScratchColor(255, 255, 153), new ScratchColor(255, 0, 204),
      new ScratchColor(255, 51, 204), new ScratchColor(255, 102, 204),
      new ScratchColor(255, 153, 204), new ScratchColor(255, 204, 204),
      new ScratchColor(255, 255, 204), new ScratchColor(255, 0, 255),
      new ScratchColor(255, 51, 255), new ScratchColor(255, 102, 255),
      new ScratchColor(255, 153, 255), new ScratchColor(255, 204, 255),
      new ScratchColor(255, 255, 255)],
    writable: true,
    enumerable: true
  },
  getImageData: {
    value: function ScratchForm_getImageData(ctx) {
      var pixels = this.getPixels();
      var depth = this.depth;
      var width = this.width;
      var height = this.height;

      var length = width * height * 4;
      var imageData = ctx ? ctx.createImageData(width, height) :
        { data: new Uint8Array(length), width: width, height: height };
      var data = imageData.data;
      if (depth <= 8) {
        var itemsPerInt = 0 | (32 / depth);
        var firstShift = (itemsPerInt - 1) * depth;
        var mask = (1 << depth) - 1;
        var colorMap = this.colors;
        for (var i = 0, j = 0, q = 0; i < length; j++) {
          var n = pixels[j];
          for (var shift = firstShift; shift >= 0; shift -= depth) {
            var index = (n >>> shift) & mask;
            var color = colorMap[index];
            data[i] = color.r;
            data[i + 1] = color.g;
            data[i + 2] = color.b;
            data[i + 3] = color.a;
            i += 4;
            if (++q >= width) {
              q = 0;
              break;
            }
          }
        }      
      } else if (depth == 16) {
        for (var i = 0, j = 0, q = 0; i < length; j++) {
          var n = pixels[j];
          data[i] = (n >>> 23) & 0xF1;
          data[i + 1] = (n >>> 18) & 0xF1;
          data[i + 2] = (n >>> 13) & 0xF1;
          data[i + 3] = (n & 0xFFFF0000) ? 0xFF : 0;
          i += 4;
          if (++q >= width) {
            q = 0;
            continue;
          }
          data[i] = (n >>> 7) & 0xF1;
          data[i + 1] = (n >>> 2) & 0xF1;
          data[i + 2] = (n << 3) & 0xF1;
          data[i + 3] = (n & 0xFFFF) ? 0xFF : 0;
          i += 4;
          if (++q >= width)
            q = 0;
        }
      } else if (depth == 32) {
        for (var i = 0, j = 0; i < length; i += 4, j++) {
          var n = pixels[j];
          data[i] = (n >> 16) & 0xFF;
          data[i + 1] = (n >> 8) & 0xFF;
          data[i + 2] = n & 0xFF;
          data[i + 3] = n ? 0xFF : 0;
        }
      } else
        throw 'Unsupported depth: ' + depth;

      return imageData;
    }
  }
});

function ScratchColorForm(fields) {
  if (arguments.length === 0) return;
  ScratchForm.apply(this, arguments);

  assignDelayedObject(this, 'colors', fields[5]);
}
ScratchColorForm.prototype = Object.create(new ScratchForm);


function SampledSound(classId, version, fields) {
  if (arguments.length === 0) return;
  ScratchObject.apply(this, arguments);

  assignDelayedObject(this, 'envelopes', fields[0]);
  assignDelayedObject(this, 'scaledVol', fields[1]);
  assignDelayedObject(this, 'initialCount', fields[2]);
  assignDelayedObject(this, 'samples', fields[3]);
  assignDelayedObject(this, 'originalSamplingRate', fields[4]);
  assignDelayedObject(this, 'samplesSize', fields[5]);
  assignDelayedObject(this, 'scaledIncrement', fields[6]);
  assignDelayedObject(this, 'scaledInitialIndex', fields[7]);
}

var ScratchObjectProxies = {
  '100': Morph,
  '109': SampledSound,
  '124': ScratchSpriteMorph,
  '125': ScratchStageMorph,
  '162': ImageMedia,
  '164': SoundMedia
};
