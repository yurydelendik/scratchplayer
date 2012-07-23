function executeBlock(obj, args, thread) {
  if (!(args[0] instanceof ScratchSymbol))
    throw 'Unsupported block type';

  switch(args[0].symbol) {
    case 'hide':
      obj.visibility = 0;
      break;
    case 'show':
      obj.visibility = 100;
      break;
    case 'showBackground:':
    case 'lookLike:':
      var costumeName = args[1];
      for (var i = 0; i < obj.media.length; i++) {
        if (costumeName == obj.media[i].mediaName)
          obj.costume = obj.media[i];
      }
      break;
    case 'changeGraphicEffect:by:':
      // TODO
      break;
    case 'turnLeft:':
      obj.rotationDegrees += args[1];
      break;
    case 'turnRight:':
      obj.rotationDegrees -= args[1];
      break;
    case 'forward:':
      var alpha = obj.rotationDegrees / 180 * Math.PI;
      var dx = args[1] * Math.cos(alpha);
      var dy = args[1] * Math.sin(alpha);
      obj.bounds.offset(dx, dy);
      break;
    case 'doRepeat':
      if (args[1] > 0) {
        thread.pushState(args[2], 0, (function(times) {
          return function() {
            if ((--times) <= 0)
              return false;
            thread.currentIndex = 0;
            return true;
          };
        })(args[1]));
      }
      break;
    case 'doReturn':
      thread.stop = true;
      break;
    case 'wait:elapsed:from:':
      thread.sleep = args[1] * 1000;
      break;
    case 'say:duration:elapsed:from:':
      if (!obj.$attachments)
        obj.$attachments = [];
      var attachment = {
        type: 'say',
        message: args[1]
      };
      obj.$attachments.push(attachment);
      setTimeout(function() {
        var i = obj.$attachments.indexOf(attachment);
        if (i >= 0)
          obj.$attachments.splice(i, 1);
        thread.context.dirty = true;
      }, args[2] * 1000);
      break;
    case 'stopAll':
      thread.stop = true;
      thread.context.stopped = true;
      break;
    default:
      throw 'Unsupported block type: ' + args[0].symbol;
  }
}

function ScratchThread(obj, context, block, index) {
  this.obj = obj;
  this.context = context;
  this.currentBlock = block;
  this.currentIndex = index;
  this.stopped = false;
  this.states = [];
}
ScratchThread.prototype = {
  pushState: function(block, index, oncomplete) {
    var state = {block: this.currentBlock, index: this.currentIndex, oncomplete: this.oncomplete };
    this.states.push(state);

    this.currentBlock = block;
    this.currentIndex = index;
    this.oncomplete = oncomplete;
    this.statePushed = true;
  },
  nextInstruction: function() {
    if (this.stopped)
      return false;
    do {
      if (this.canAdvance) {
        if (this.canAdvance())
          return true;
        delete this.canAdvance;
      }
      if (this.statePushed)
        delete this.statePushed;
      else
        this.currentIndex++;
      if (this.currentIndex < this.currentBlock.length)
        return true;
      if (this.oncomplete) {
        if (this.oncomplete())
          return true;
      }
      if (this.states.length == 0) {
        this.stopped = true;
        return false;
      }
      this.popState();
    } while (true);
  },
  popState: function() {
    if (this.states.length === 0)
      throw 'Cannot pop the thread state';
    var state = this.states.pop();
    this.currentBlock = state.block;
    this.currentIndex = state.index;
    this.canAdvance = state.canAdvance;
  }
}

var ScratchPlayer = (function ScratchPlayerClosure() {
  function initialize(obj, context) {
    function buildEventHandler(block) {
      var eventName = block[0][1];
      return function(name) {
        if (eventName == name) {
          var thread = new ScratchThread(obj, context, block, 1);
          context.queueInstruction(thread);
        }
      };
    }

    // build media cache
    for (var i = 0; i < obj.media.length; i++) {
      var media = obj.media[i];
      if (media.form) {
        var canvas = document.createElement('canvas');
        canvas.width = media.form.width;
        canvas.height = media.form.height;
        var ctx = canvas.getContext('2d');
        var imageData = media.form.getImageData(ctx);
        ctx.putImageData(imageData, 0, 0);
        media.$image = canvas;
      }
    }
    // scan blocks
    for (var i = 0; i < obj.blocksBin.length; i++) {
      var block = obj.blocksBin[i][1];
      if (block[0][0] instanceof ScratchSymbol &&
          block[0][0].symbol == 'EventHatMorph') {
        context.events.push(buildEventHandler(block));
      }
    }
  }

  function ScratchPlayer(model, canvas) {
    var stage = model.contents;
    this.stage = stage;
    canvas.width = stage.bounds.x2;
    canvas.height = stage.bounds.y2;
    var canvasContext = canvas.getContext('2d');
    this.context = {
      stopped: true,
      canvasContext: canvasContext,
      events: [],
      queueInstruction: function(thread) {
        if (this.stopped)
          return;

        var args = thread.currentBlock[thread.currentIndex];
        var bmp = thread.obj.tempoBPM;
        executeBlock(thread.obj, args, thread);
        if (thread.nextInstruction()) {
          var interval = Math.floor(1000 / bmp);
          if (thread.sleep) {
            interval = thread.sleep;
            delete thread.sleep;
          }
          setTimeout(this.queueInstruction.bind(this, thread),
                     interval);
        }
        this.dirty = true;
      },
      dirty: true
    };
    initialize(stage, this.context);
    this.sprites = [];
    for (var i = 0; i < model.contents.sprites.length; i++) {
      var sprite = stage.sprites[i];
      initialize(sprite, this.context);
      this.sprites.push(sprite);
    }
    this.draw();
  }

  ScratchPlayer.prototype = {
    draw: function() {
      var ctx = this.context.canvasContext;
      ctx.save();

      var stage = this.stage;
      var costume = stage.costume;
      var background = costume.$image;
      ctx.drawImage(background, 0, 0);

      for (var i = 0; i < this.sprites.length; i++) {
        var sprite = this.sprites[i];
        if (!sprite.visibility)
          continue;
        var costume = sprite.costume;
        var img = costume.$image;
        ctx.save();
        ctx.translate(sprite.bounds.x1 + costume.rotationCenter.x,
                      sprite.bounds.y1 + costume.rotationCenter.y);
        ctx.scale(sprite.scalePoint.x, sprite.scalePoint.y);
        ctx.rotate(sprite.rotationDegrees / 180 * Math.PI);
        ctx.drawImage(img, -costume.rotationCenter.x, -costume.rotationCenter.y);
        ctx.restore();

        if (sprite.$attachments) {
          for (var j = 0; j < sprite.$attachments.length; j++) {
            var attachment = sprite.$attachments[j];
            switch (attachment.type) {
              case 'say':
                ctx.font = '20px sans-serif';
                var bounds = ctx.measureText(attachment.message);
                ctx.fillStyle = 'white';
                ctx.fillRect(sprite.bounds.x1 + costume.rotationCenter.x, sprite.bounds.y1 - 20, bounds.width, 20);
                ctx.fillStyle = 'black';
                ctx.fillText(attachment.message, sprite.bounds.x1 + costume.rotationCenter.x, sprite.bounds.y1);
                break;
            }
          }
        }
        ctx.restore();
      }

      ctx.restore();
      this.context.dirty = false;
    },
    start: function() {
      var context = this.context;
      context.stopped = false;
      for (var i = 0; i < this.context.events.length; i++) {
        context.events[i]('Scratch-StartClicked');
      }
      var player = this;
      context.drawInterval = setInterval(function() {
        if (context.dirty)
          player.draw();
      }, 20);
    },
    stop: function() {
      clearInterval(context.drawInterval);
      this.context.stopped = true;
    }
  };

  return ScratchPlayer;
})();