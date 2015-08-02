import Delegate from 'dom-delegate';
import objectPath from 'object-path';
import Firebase from 'firebase';

let delegate = new Delegate(document);

//TODO: Make this pull from the path-data prop on the dom
let firebaseRef = new Firebase(localStorage.getItem('firebaseUrl') || 'https://EXAMPLE.firebaseio.com');
let dataRef = firebaseRef.child('test/form');
let uploadsRef = firebaseRef.child('test/uploads');

let data = null;
let newData = {};

dataRef.on('value', (snapshot) => {
  newData = snapshot.val();

  console.time('update dom');

  // expand arrays to fit the content
  applyDomChanges('[data-type=collection]', function(el, newValue) {
    let path = extractObjectPath(el);    

    //force the fields to reload their content in the collection
    if (data !== null) {
      objectPath.set(data, path, {});
    }

    let childTemplate = el.dataset.childTemplate;
    if (!childTemplate) {
      childTemplate = el.dataset.childTemplate = el.innerHTML;
    }

    el.innerHTML = Object.keys(newValue || {}).map((id)=> {
      return childTemplate.replace(/data-path="([^"]*)"/g, function(match, path) {
        if (path === '.') {
          return `data-path="${id}"`;
        } else {
          return `data-path="${id}/${path}"`;
        }        
      });
    }).join('');
  }, function(obj) {
    return Object.keys(obj || {}).join();
  });

  applyDomChanges('div[data-if]', (el, newValue) => {         
    if (newValue) {
      el.style.display = 'inline-block';
    } else {
      el.style.display = 'none';
    }
  }, function(val) {
    return !!val;
  });

  applyDomChanges('img[data-path]', (el, newValue) => {    
    let fbPath = extractFbPath(el);    

    if (newValue) {
      uploadsRef.child(fbPath).once('value', function(data) {     
        el.src = data.val();
        el.style.display = 'inline-block';
      });
    } else {
      el.style.display = 'none';
    }
  }, function(val) {
    return val ? val.lastModified : null;    
  });

  applyDomChanges('input[data-path]', (el, newValue) => {    
    switch (el.type) {
      case 'file':
        break;
      case 'checkbox':
        el.checked = newValue === 1;
        break;
      default:
        el.value = newValue || '';
    }
  });

  applyDomChanges('textarea[data-path]', (el, newValue) => {    
    el.innerText = newValue || '';
  });

  data = newData;
  console.timeEnd('update dom');
});

function applyDomChanges(selector, applier, hash) {
  hash = hash || function(value) {
    return value;
  };

  var matches = document.querySelectorAll(selector);    

  for (let i=0, n = matches.length; i < n; i ++) {
    let el = matches.item(i);    
    let path = extractObjectPath(el);    

    let newValue = objectPath.get(newData, path);
    if (data === null) {    
      applier(el, newValue);
      continue;
    }

    let oldValue = objectPath.get(data, path);    
    if (hash(newValue) !== hash(oldValue)) {
      applier(el, newValue);
    }
  }
}

delegate.on('click', '[data-action=add][data-path]', function(e) {
  let fbPath = extractFbPath(e.target).replace(/\/.$/g, '');
  dataRef.child(fbPath).push({added: Date.now()});
});

delegate.on('click', '[data-action=remove][data-path]', function(e) {
  let fbPath = extractFbPath(e.target);

  if (confirm('Are you sure?')) {
    dataRef.child(fbPath).remove(function() {
      uploadsRef.child(fbPath).remove();  
    });
  }
});

delegate.on('change', 'input[type=file][data-path]', function(e) {
  let fbPath = extractFbPath(e.target);
  
  var reader = new FileReader();  

  let file = e.target.files[0];
  reader.onload = function(e) {  
    uploadsRef.child(fbPath).set(e.target.result, function() {
      dataRef.child(fbPath).set({
        lastModified: file.lastModified, 
        name: file.name, 
        size: file.size, 
        type: file.type
      });
    });
  };

  reader.readAsDataURL(file);
});

delegate.on('change', 'input[type=number][data-path]', function(e) {
  let path = extractFbPath(e.target);
  let value = Number(e.target.value);

  dataRef.child(path).set(value);
});

delegate.on('change', 'input[type=checkbox][data-path]', function(e) {
  let path = extractFbPath(e.target);
  let value = e.target.checked ? 1 : 0;

  dataRef.child(path).set(value);
});

delegate.on('change', ['email', 'text'].map(type => `input[type=${type}][data-path]`).join(','), function(e) {
  let path = extractFbPath(e.target);
  let value = e.target.value;

  dataRef.child(path).set(value || undefined);
});

delegate.on('change', 'textarea[data-path]', function(e) {
  let path = extractFbPath(e.target);
  let value = e.target.innerText;

  dataRef.child(path).set(value || undefined);
});

// Recurses up the dom tree to determine an elements full Firebase Path
function extractFbPath(el) {
  if (!el) return '';

  let path = el.dataset ? el.dataset.path : '/';
  if (!path) {
    path = extractFbPath(el.parentNode);
  } 
  
  if (!path.match(/^\//)) {  
    path = extractFbPath(el.parentNode) + '/' + path;    
  }

  path = path.replace(/^\/\//, '/');

  path = path.replace(/\/[.]$/, '');

  objectPath.set(el, 'dataset.path', path);  

  return path;
}

function extractObjectPath(el) {
  // /a/b => ['a', 'b']
  return extractFbPath(el).substr(1).split('/');
}
