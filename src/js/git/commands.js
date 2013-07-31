var _ = require('underscore');
var intl = require('../intl');

var Errors = require('../util/errors');
var CommandProcessError = Errors.CommandProcessError;
var GitError = Errors.GitError;
var Warning = Errors.Warning;
var CommandResult = Errors.CommandResult;

var commandConfig;
var commands = {
  execute: function(name, engine, commandObj) {
    if (!commandConfig[name]) {
      throw new Error('i dont have a command for ' + name);
    }
    commandConfig[name].execute.call(this, engine, commandObj);
  },

  getRegex: function(name) {
    name = name.replace(/-/g, ''); // ugh cherry-pick @____@
    if (!commandConfig[name]) {
      throw new Error('i dont have a regex for ' + name);
    }
    return commandConfig[name].regex;
  },

  getShortcutMap: function() {
    var map = {'git': {}};
    this.loop(function(config, name, vcs) {
      if (!config.sc) {
        return;
      }
      map[vcs][name] = config.sc;
    }, this);
    return map;
  },

  getOptionMap: function() {
    var optionMap = {'git': {}};
    this.loop(function(config, name, vcs) {
      var displayName = config.displayName || name;
      var thisMap = {};
      // start all options off as disabled
      _.each(config.options, function(option) {
        thisMap[option] = false;
      });
      optionMap[vcs][displayName] = thisMap;
    });
    return optionMap;
  },

  getRegexMap: function() {
    var map = {};
    this.loop(function(config, name) {
      var displayName = 'git ' + (config.displayName || name);
      map[displayName] = config.regex;
    });
    return map;
  },

  /**
   * which commands count for the git golf game
   */
  getCommandsThatCount: function() {
    var counted = [];
    this.loop(function(config, name) {
      if (config.dontCountForGolf) {
        return;
      }
      counted.push(name);
    });
    return counted;
  },

  loop: function(callback, context) {
    _.each(commandConfig, function (config, name) { callback(config, name, 'git') });
  }
};

commandConfig = {
  hgcommit: {
    regex: /^(hg +commit|hg +ci)($|\s)/,
    options: [
      '--amend',
      '-m'
    ],
    execute: function(engine, command) {
      return commandConfig.commit.execute(engine, command);
    }
  },
  commit: {
    sc: /^(gc|git ci)($|\s)/,
    regex: /^git +commit($|\s)/,
    options: [
      '--amend',
      '-a',
      '-am',
      '-m'
    ],
    execute: function(engine, command) {
      var commandOptions = command.getSupportedMap();
      command.acceptNoGeneralArgs();

      if (commandOptions['-am'] && (
          commandOptions['-a'] || commandOptions['-m'])) {
        throw new GitError({
          msg: intl.str('git-error-options')
        });
      }

      var msg = null;
      var args = null;
      if (commandOptions['-a']) {
        command.addWarning(intl.str('git-warning-add'));
      }

      if (commandOptions['-am']) {
        args = commandOptions['-am'];
        command.validateArgBounds(args, 1, 1, '-am');
        msg = args[0];
      }

      if (commandOptions['-m']) {
        args = commandOptions['-m'];
        command.validateArgBounds(args, 1, 1, '-m');
        msg = args[0];
      }

      var newCommit = engine.commit({
        isAmend: commandOptions['--amend']
      });
      if (msg) {
        msg = msg
          .replace(/&quot;/g, '"')
          .replace(/^"/g, '')
          .replace(/"$/g, '');

        newCommit.set('commitMessage', msg);
      }

      var promise = engine.animationFactory.playCommitBirthPromiseAnimation(
        newCommit,
        engine.gitVisuals
      );
      engine.animationQueue.thenFinish(promise);
    }
  },

  cherrypick: {
    displayName: 'cherry-pick',
    regex: /^git +cherry-pick($|\s)/,
    execute: function(engine, command) {
      var commandOptions = command.getSupportedMap();
      var generalArgs = command.getGeneralArgs();

      command.validateArgBounds(generalArgs, 1, Number.MAX_VALUE);

      var set = engine.getUpstreamSet('HEAD');
      // first resolve all the refs (as an error check)
      var toCherrypick = _.map(generalArgs, function(arg) {
        var commit = engine.getCommitFromRef(arg);
        // and check that its not upstream
        if (set[commit.get('id')]) {
          throw new GitError({
            msg: intl.str(
              'git-error-already-exists',
              { commit: commit.get('id') }
            )
          });
        }
        return commit;
      }, this);

      engine.setupCherrypickChain(toCherrypick);
    }
  },

  pull: {
    regex: /^git +pull($|\s)/,
    options: [
      '--rebase'
    ],
    execute: function(engine, command) {
      if (!engine.hasOrigin()) {
        throw new GitError({
          msg: intl.str('git-error-origin-required')
        });
      }

      var commandOptions = command.getSupportedMap();
      command.acceptNoGeneralArgs();
      engine.pull({
        isRebase: commandOptions['--rebase']
      });
    }
  },

  fakeTeamwork: {
    regex: /^git +fakeTeamwork($|\s)/,
    execute: function(engine, command) {
      var generalArgs = command.getGeneralArgs();
      if (!engine.hasOrigin()) {
        throw new GitError({
          msg: intl.str('git-error-origin-required')
        });
      }

      command.validateArgBounds(generalArgs, 0, 2);
      // allow formats of: git Faketeamwork 2 or git Faketeamwork side 3
      var branch = (engine.origin.refs[generalArgs[0]]) ?
        generalArgs[0] : 'master';
      var numToMake = parseInt(generalArgs[0], 10) || generalArgs[1] || 1;

      // make sure its a branch and exists
      var destBranch = engine.origin.resolveID(branch);
      if (destBranch.get('type') !== 'branch') {
        throw new GitError({
          msg: intl.str('git-error-options')
        });
      }
        
      engine.fakeTeamwork(numToMake, branch);
    }
  },

  clone: {
    regex: /^git +clone *?$/,
    execute: function(engine, command) {
      command.acceptNoGeneralArgs();
      engine.makeOrigin(engine.printTree());
    }
  },

  fetch: {
    regex: /^git +fetch *?$/,
    execute: function(engine, command) {
      if (!engine.hasOrigin()) {
        throw new GitError({
          msg: intl.str('git-error-origin-required')
        });
      }
      command.acceptNoGeneralArgs();
      engine.fetch();
    }
  },

  branch: {
    sc: /^(gb|git br)($|\s)/,
    regex: /^git +branch($|\s)/,
    options: [
      '-d',
      '-D',
      '-f',
      '-a',
      '-r',
      '--contains'
    ],
    execute: function(engine, command) {
      var commandOptions = command.getSupportedMap();
      var generalArgs = command.getGeneralArgs();

      var args = null;
      // handle deletion first
      if (commandOptions['-d'] || commandOptions['-D']) {
        var names = commandOptions['-d'] || commandOptions['-D'];
        command.validateArgBounds(names, 1, Number.MAX_VALUE, '-d');

        _.each(names, function(name) {
          engine.deleteBranch(name);
        });
        return;
      }

      if (commandOptions['--contains']) {
        args = commandOptions['--contains'];
        command.validateArgBounds(args, 1, 1, '--contains');
        engine.printBranchesWithout(args[0]);
        return;
      }

      if (commandOptions['-f']) {
        args = commandOptions['-f'];
        command.twoArgsImpliedHead(args, '-f');

        // we want to force a branch somewhere
        engine.forceBranch(args[0], args[1]);
        return;
      }


      if (generalArgs.length === 0) {
        var branches;
        if (commandOptions['-a']) {
          branches = engine.getBranches();
        } else if (commandOptions['-r']) {
          branches = engine.getRemoteBranches();
        } else {
          branches = engine.getLocalBranches();
        }
        engine.printBranches(branches);
        return;
      }

      command.twoArgsImpliedHead(generalArgs);
      engine.branch(generalArgs[0], generalArgs[1]);
    }
  },

  add: {
    dontCountForGolf: true,
    sc: /^ga($|\s)/,
    regex: /^git +add($|\s)/,
    execute: function() {
      throw new CommandResult({
        msg: intl.str('git-error-staging')
      });
    }
  },

  reset: {
    regex: /^git +reset($|\s)/,
    options: [
      '--hard',
      '--soft'
    ],
    execute: function(engine, command) {
      var commandOptions = command.getSupportedMap();
      var generalArgs = command.getGeneralArgs();

      if (commandOptions['--soft']) {
        throw new GitError({
          msg: intl.str('git-error-staging')
        });
      }
      if (commandOptions['--hard']) {
        command.addWarning(
          intl.str('git-warning-hard')
        );
        // dont absorb the arg off of --hard
        generalArgs = generalArgs.concat(commandOptions['--hard']);
      }

      command.validateArgBounds(generalArgs, 1, 1);

      if (engine.getDetachedHead()) {
        throw new GitError({
          msg: intl.str('git-error-reset-detached')
        });
      }

      engine.reset(generalArgs[0]);
    }
  },

  revert: {
    regex: /^git +revert($|\s)/,
    execute: function(engine, command) {
      var generalArgs = command.getGeneralArgs();

      command.validateArgBounds(generalArgs, 1, Number.MAX_VALUE);
      engine.revert(generalArgs);
    }
  },

  merge: {
    regex: /^git +merge($|\s)/,
    execute: function(engine, command) {
      var generalArgs = command.getGeneralArgs();
      command.validateArgBounds(generalArgs, 1, 1);

      var newCommit = engine.merge(generalArgs[0]);

      if (newCommit === undefined) {
        // its just a fast forwrard
        engine.animationFactory.refreshTree(
          engine.animationQueue, engine.gitVisuals
        );
        return;
      }

      engine.animationFactory.genCommitBirthAnimation(
        engine.animationQueue, newCommit, engine.gitVisuals
      );
    }
  },

  log: {
    dontCountForGolf: true,
    regex: /^git +log($|\s)/,
    execute: function(engine, command) {
      var generalArgs = command.getGeneralArgs();

      if (generalArgs.length == 2) {
        // do fancy git log branchA ^branchB
        if (generalArgs[1][0] == '^') {
          engine.logWithout(generalArgs[0], generalArgs[1]);
        } else {
          throw new GitError({
            msg: intl.str('git-error-options')
          });
        }
      }

      command.oneArgImpliedHead(generalArgs);
      engine.log(generalArgs[0]);
    }
  },

  show: {
    dontCountForGolf: true,
    regex: /^git +show($|\s)/,
    execute: function(engine, command) {
      var generalArgs = command.getGeneralArgs();
      command.oneArgImpliedHead(generalArgs);
      engine.show(generalArgs[0]);
    }
  },

  rebase: {
    sc: /^gr($|\s)/,
    options: [
      '-i',
      '--aboveAll'
    ],
    regex: /^git +rebase($|\s)/,
    execute: function(engine, command) {
      var commandOptions = command.getSupportedMap();
      var generalArgs = command.getGeneralArgs();

      if (commandOptions['-i']) {
        var args = commandOptions['-i'];
        command.twoArgsImpliedHead(args, ' -i');
        engine.rebaseInteractive(
          args[0],
          args[1], {
            aboveAll: !!commandOptions['--aboveAll']
          }
        );
        return;
      }

      command.twoArgsImpliedHead(generalArgs);
      engine.rebase(generalArgs[0], generalArgs[1]);
    }
  },

  status: {
    dontCountForGolf: true,
    sc: /^(gst|gs|git st)($|\s)/,
    regex: /^git +status($|\s)/,
    execute: function(engine) {
      // no parsing at all
      engine.status();
    }
  },

  checkout: {
    sc: /^(go|git co)($|\s)/,
    regex: /^git +checkout($|\s)/,
    options: [
      '-b',
      '-B',
      '-'
    ],
    execute: function(engine, command) {
      var commandOptions = command.getSupportedMap();
      var generalArgs = command.getGeneralArgs();

      var args = null;
      if (commandOptions['-b']) {
        if (generalArgs.length) {
          throw new GitError({
            msg: intl.str('git-error-options')
          });
        }

        // the user is really trying to just make a branch and then switch to it. so first:
        args = commandOptions['-b'];
        command.twoArgsImpliedHead(args, '-b');

        var validId = engine.validateBranchName(args[0]);
        engine.branch(validId, args[1]);
        engine.checkout(validId);
        return;
      }

      if (commandOptions['-']) {
        // get the heads last location
        var lastPlace = engine.HEAD.get('lastLastTarget');
        if (!lastPlace) {
          throw new GitError({
            msg: intl.str('git-result-nothing')
          });
        }
        engine.HEAD.set('target', lastPlace);
        return;
      }

      if (commandOptions['-B']) {
        args = commandOptions['-B'];
        command.twoArgsImpliedHead(args, '-B');

        engine.forceBranch(args[0], args[1]);
        engine.checkout(args[0]);
        return;
      }

      command.validateArgBounds(generalArgs, 1, 1);

      engine.checkout(engine.crappyUnescape(generalArgs[0]));
    }
  },

  push: {
    regex: /^git +push($|\s)/,
    execute: function(engine, command) {
      if (!engine.hasOrigin()) {
        throw new GitError({
          msg: intl.str('git-error-origin-required')
        });
      }
      command.acceptNoGeneralArgs();
      engine.push();
    }
  }
};

var instantCommands = [
  [/^(git help($|\s)|git$)/, function() {
    var lines = [
      intl.str('git-version'),
      '<br/>',
      intl.str('git-usage'),
      _.escape(intl.str('git-usage-command')),
      '<br/>',
      intl.str('git-supported-commands'),
      '<br/>'
    ];
    var commands = commands.getOptionMap()['git'];
    // build up a nice display of what we support
    _.each(commands, function(commandOptions, command) {
      lines.push('git ' + command);
      _.each(commandOptions, function(vals, optionName) {
        lines.push('\t ' + optionName);
      }, this);
    }, this);

    // format and throw
    var msg = lines.join('\n');
    msg = msg.replace(/\t/g, '&nbsp;&nbsp;&nbsp;');
    throw new CommandResult({
      msg: msg
    });
  }]
];

var parse = function(str) {
  var vcs;
  var method;
  var options;

  // see if we support this particular command
  _.each(commands.getRegexMap(), function(regex, thisMethod) {
    if (regex.exec(str)) {
      vcs = 'git'; // XXX get from regex map
      options = str.slice(thisMethod.length + 1);
      method = thisMethod.slice(vcs.length + 1);
    }
  });

  if (!method) {
    return false;
  }

  // we support this command!
  // parse off the options and assemble the map / general args
  var parsedOptions = new CommandOptionParser(vcs, method, options);
  return {
    toSet: {
      generalArgs: parsedOptions.generalArgs,
      supportedMap: parsedOptions.supportedMap,
      vcs: vcs,
      method: method,
      options: options,
      eventName: 'processGitCommand'
    }
  };
};

/**
 * CommandOptionParser
 */
function CommandOptionParser(vcs, method, options) {
  this.vcs = vcs;
  this.method = method;
  this.rawOptions = options;

  this.supportedMap = commands.getOptionMap()[vcs][method];
  if (this.supportedMap === undefined) {
    throw new Error('No option map for ' + method);
  }

  this.generalArgs = [];
  this.explodeAndSet();
}

CommandOptionParser.prototype.explodeAndSet = function() {
  // TODO -- this is ugly
  // split on spaces, except when inside quotes
  var exploded = this.rawOptions.match(/('.*?'|".*?"|\S+)/g) || [];
  for (var i = 0; i < exploded.length; i++) {
    var part = exploded[i];

    if (part.slice(0,1) == '-') {
      // it's an option, check supportedMap
      if (this.supportedMap[part] === undefined) {
        throw new CommandProcessError({
          msg: intl.str(
            'option-not-supported',
            { option: part }
          )
        });
      }

      // go through and include all the next args until we hit another option or the end
      var optionArgs = [];
      var next = i + 1;
      while (next < exploded.length && exploded[next].slice(0,1) != '-') {
        optionArgs.push(exploded[next]);
        next += 1;
      }
      i = next - 1;

      // **phew** we are done grabbing those. theseArgs is truthy even with an empty array
      this.supportedMap[part] = optionArgs;
    } else {
      // must be a general arg
      this.generalArgs.push(part);
    }
  }
};

exports.commands = commands;
exports.instantCommands = instantCommands;
exports.parse = parse;

