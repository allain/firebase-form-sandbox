var objectPath = require('object-path');
var Delegate = require('dom-delegate');
var Firebase = require('firebase');

module.exports = FirebaseTemplate;

function FirebaseTemplate(options) {
  options = options || {};

  var root = options.el || document.querySelector('body');

  var rootPath = root.dataset.path;
  if (!rootPath)
    throw new Error('data-path not set not set on target');

  var authToken = root.dataset.jwt;

  var firebaseRef = new Firebase(rootPath);
  delete root.dataset.path;

  queryAll('input:not([type])').forEach(function (el) {
    el.type = 'text';
  });

  // Make images displaying firebase content appear clickable
  var newStyles = document.createElement('style');
  newStyles.innerText = 'img[data-path] { cursor: pointer; }';
  document.body.appendChild(newStyles);

  if (authToken) {
    firebaseRef.authWithCustomToken(authToken, function (err, authData) {
      if (err) {
        throw new Error('Auth Failed ' + err);
      }

      // console.log("Login Succeeded!", authData);
    });
  } else {
    console.warn('data-jwt not given, so assuming anonymous access');
  }

  var dataRef = firebaseRef.child('data');
  var uploadsRef = firebaseRef.child('uploads');
  var delegate = new Delegate(root);

  var oldData = null;
  var newData = JSON.parse(localStorage.getItem('data:' + rootPath) || '{}');

  var lazyUpdateDomCollections = lazyApply(updateDomCollections, function (obj) {
    return Object.keys(obj || {}).join();
  });

  var lazyUpdateDomImgs = lazyApply(updateDomImgs, function (val) {
    return val ? val.lastModified : null;
  });

  var lazyUpdateDomInputs = lazyApply(updateDomInputs);

  return {
    start: start,
    stop: stop
  };

  function start() {
    oldData = null;
    newData = JSON.parse(localStorage.getItem('data:' + rootPath) || '{}');

    updateDom();

    dataRef.on('value', function (snapshot) {
      newData = snapshot.val();
      localStorage.setItem('data:' + rootPath, JSON.stringify(newData));
      updateDom();
    });

    delegate.off();

    delegate.on('click', 'img[data-path]', function (e) {
      uploadsRef.child(extractFbPath(e.target) + '/raw').once('value', function (snapshot) {
        var src = snapshot.val();
        window.open(src, '_blank');
      });
    });

    delegate.on('click', '[data-action=add][data-path]', function (e) {
      dataRef.child(extractFbPath(e.target)).push({added: Date.now()});
    });

    delegate.on('click', '[data-action=remove][data-path]', function (e) {
      if (confirm('Are you sure?')) {
        var fbPath = extractFbPath(e.target);

        dataRef.child(fbPath).remove(function () {
          uploadsRef.child(fbPath).remove();
        });
      }
    });

    delegate.on('change', 'input[type=file][data-path]', function (e) {
      var fbPath = extractFbPath(e.target);
      var file = e.target.files[0];
      var reader = new FileReader();

      reader.onload = function (e) {
        var fileMeta = {
          lastModified: file.lastModified,
          name: file.name,
          size: file.size,
          type: file.type
        };
        if (file.type.match(/^image\//)) {
          var thumb = resize(e.target.result, 100);
          uploadsRef.child(fbPath + '/thumb').set(thumb, function () {
            dataRef.child(fbPath).set(fileMeta, function () {
              uploadsRef.child(fbPath + '/raw').set(e.target.result);
            });
          });
        } else {
          uploadsRef.child(fbPath).set(e.target.result, function () {
            dataRef.child(fbPath).set(fileMeta);
          });
        }
      };

      reader.readAsDataURL(file);
    });

    delegate.on('change', 'input[type=number][data-path]', function (e) {
      setData(e.target, Number(e.target.value));
    });

    delegate.on('change', 'input[type=checkbox][data-path]', function (e) {
      setData(e.target, e.target.checked ? 1 : 0);
    });

    delegate.on('change', 'input[type=text][data-path],input[type=email][data-path],textarea[data-path]', function (e) {
      setData(e.target, e.target.value);
    });
  }

  function lazyApply(applier, hash) {
    hash = hash || function (val) {
      return val
    };

    return function (el, newValue) {
      if (oldData === null) {
        return applier(el, newValue);
      }

      var newHash = hash(newValue);
      var path = extractFbPath(el).substr(1).split('/');

      var oldHash = hash(objectPath.get(oldData, path));
      if (newHash !== oldHash) {
        applier(el, newValue);
      }
    };
  }

  function updateDom() {
    console.time('update dom');

    // expand arrays to fit the content
    applyDomChanges('[data-type=collection][data-path]', lazyUpdateDomCollections);
    applyDomChanges('img[data-path]', lazyUpdateDomImgs);
    applyDomChanges('input[data-path],textarea[data-path]', lazyUpdateDomInputs);
    applyDomChanges('[data-show]', function (el, newValue) {
      el.style.display = newValue ? '' : 'none';
    });

    oldData = newData;
    console.timeEnd('update dom');
  }

  function updateDomCollections(el, newValue) {
    var path = extractFbPath(el).substr(1).split('/');

    //force the fields to reload their content in the collection
    if (oldData !== null) {
      objectPath.set(oldData, path, {});
    }

    var childTemplate = el.dataset.childTemplate;
    if (!childTemplate) {
      childTemplate = el.dataset.childTemplate = el.innerHTML;
    }

    el.innerHTML = Object.keys(newValue || {}).map(function (id) {
      return childTemplate.replace(/data-(path|show)="([^"]*)"/g, function (match, prop, path) {
        if (path === '.') {
          return 'data-' + prop + '="' + id + '"';
        } else {
          return 'data-' + prop + '="' + id + '/' + path + '"';
        }
      });
    }).join('');
  }

  //TODO: Make this use a local storage mechanism for images, or thumbnails of them
  function updateDomImgs(el, newValue) {
    var fbPath = extractFbPath(el);

    el.style.display = newValue ? '' : 'none';
    if (newValue) {
      var thumbKey = 'thumb:' + newValue.lastModified + ':' + fbPath;
      var thumbSrc = localStorage.getItem(thumbKey);
      if (thumbSrc) {
        el.src = thumbSrc;
      } else {
        uploadsRef.child(fbPath + '/thumb').once('value', function (snapshot) {
          var imgSrc = snapshot.val();

          var thumbSrc = resize(imgSrc, 100);
          // localStorage.setItem(imgKey, imgSrc);
          el.src = imgSrc;
        });
      }
    }
  }

  function resize(imgSrc, size) {
    // from an input element

    var img = document.createElement("img");
    img.src = imgSrc;

    var reader = new FileReader();

    var canvas = document.createElement('canvas');

    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    var width = img.width;
    var height = img.height;
    if (width > height) {
      if (width > size) {
        height *= size / width;
        width = size;
      }
    } else if (height > size) {
      width *= size / height;
      height = size;
    }
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, width, height);

    return canvas.toDataURL("image/jpeg");
  }

  function updateDomInputs(el, newValue) {
    switch (el.type) {
      case 'file':
        break;
      case 'checkbox':
        el.checked = newValue === 1;
        break;
      default:
        el.value = newValue || '';
    }
  }

  function setData(el, value) {
    if (value === '') {
      dataRef.child(extractFbPath(el)).remove();
    } else {
      dataRef.child(extractFbPath(el)).set(value);
    }
  }

  function stop() {
    delegate.off();
    dataRef.off('value');

    oldData = null;
    newData = {};
  }

  function queryAll(selector) {
    return [].slice.call(root.querySelectorAll(selector));
  }

  function applyDomChanges(selector, applier) {
    queryAll(selector).forEach(function (el) {
      var path;
      if (el.dataset.show) {
        path = extractFbShowPath(el);
      } else {
        path = extractFbPath(el);
      }
      path = path.substr(1).split('/');

      applier(el, objectPath.get(newData, path));
    });
  }

  function applyConditionalDomChanges(selector, applier, hash) {
    hash = hash || function (val) {
      return val;
    };

    queryAll(selector).forEach(function (el) {
      var path;
      if (el.dataset.show) {
        path = extractFbShowPath(el);
      } else {
        path = extractFbPath(el);
      }
      path = path.substr(1).split('/');

      var newValue = objectPath.get(newData, path);
      if (oldData === null) {
        applier(el, newValue);
      } else {
        var oldValue = objectPath.get(oldData, path);
        if (hash(newValue) !== hash(oldValue)) {
          applier(el, newValue);
        }
      }
    });
  }
}

// Recurses up the dom tree to determine an elements full Firebase Path

function extractFbPath(el) {
  var path = objectPath.get(el, 'dataset.path');
  if (path && path.charAt(0) === '/') return path;

  return el.dataset.path = collapsePathParts(extractPathParts(el));
}

function extractFbShowPath(el) {
  var showPath = el.dataset.show;

  if (showPath.charAt(0) === '/') return showPath;

  return el.dataset.show = collapsePathParts(extractPathParts(el.parentNode).concat(showPath));
}

function extractPathParts(el) {
  var parts = [];
  do {
    var part = el.dataset ? el.dataset.path : null;
    parts.push(part);
  } while (el = el.parentNode);

  return parts.filter(Boolean).reverse();
}

function collapsePathParts(parts) {
  var cleanParts = [];

  parts.join('/').split('/').forEach(function (part) {
    if (part === '') {
      cleanParts = [];
    } else if (part === '..') {
      cleanParts.pop();
    } else if (part !== '.') {
      cleanParts.push(part);
    }
  });

  return '/' + cleanParts.join('/');
}


