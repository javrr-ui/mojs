import tweener from './tweener';
import parseEasing from '../easing/helpers/parse-easing';
import defaults from './tween-defaults';

/**
 * Tween factory to create a tween.
 *
 * @param {Object} Tween options.
 * @returns {Object} Newly created tween.
 */
const tweenFactory = (o = {}) => {
  // state of the tween {string}
  let state = 'stop';
  // previous state of the tween {string}
  let prevState = 'stop';
  // if second update (for the first update will be set to `undefined`){boolean}
  let wasUknownUpdate;
  // start time of the tween
  let startTime;
  // end time of the tween including all repeat periods
  let endTime;
  // play time of the tween - analog to start time but used when you hit `play`
  // oppose to if you just seek the tween
  let playTime;
  // progress of the tween in `ms` {number}
  let progressTime = 0;
  // previous update time
  let prevTime;
  // if prev period was `yoyo` (flipped) period {boolean}
  let isPrevYoyo;
  // time when tween was resumed
  let resumeTime;
  // progress of the tween
  let progress = 0;
  // negative shift for negative delays
  let negativeShift = 0;
  // tween object to return
  const tween = {};

  /**
   * Flags
   */
  // if tween is completed
  let isCompleted = false;
  // if tween is completed after repeat period
  let isRepeatCompleted = false;
  // if tween is started repeat period
  let isRepeatStart = false;
  // if tween is started - there was at least one update in its
  // `active` zone {boolean}
  let isStarted = false;
  // if tween was updated at least once {boolean}
  let isFirstUpdate = false;
  // If updateTime is in active tween area {boolean}
  let isInActiveArea = false;
  // If tween refreshed after finish and start over(in delay period) {boolean}
  let isRefreshed = false;
  // state of the tween {boolean}
  let isRunning = false;
  // playing state of the tween {boolean}
  let isReversed = false;

  /**
   * Properties of the tween extended by defaults,
   * all of them should be prefixed with `$` internaly.
   */
  let $delay = (o.delay != null) ? o.delay : defaults.delay;
  const $duration = (o.duration != null) ? o.duration : defaults.duration;
  const $repeat = (o.repeat != null) ? o.repeat : defaults.repeat;
  const $shiftTime = o.shiftTime || 0;

  const $easing = (o.easing != null) ? o.easing : defaults.easing;
  const $parsedEasing = parseEasing($easing);
  $parsedEasing.setParent(tween);

  const $backwardEasing = o.backwardEasing;
  let $parsedBackwardEasing;
  if ($backwardEasing) {
    $parsedBackwardEasing = parseEasing($backwardEasing);
    $parsedBackwardEasing.setParent(tween);
  }

  let $speed = (o.speed != null) ? o.speed : defaults.speed;
  const $isYoyo = (o.isYoyo != null) ? o.isYoyo : defaults.isYoyo;

  /***** Private Methods *****/

  if ($delay < 0) {
    negativeShift = $delay;
    $delay = 0;
  }

  /**
   * Calculate dimentions.
   */
  // one repeat period time
  let time = $delay + $duration;
  // total time of the tween
  let repeatTime = time * ($repeat + 1);

  /**
   * _setStartTime - Method for setting start and end time to props.
   *
   * @private
   * @param {Number(Timestamp)}, {Null} Start time.
   * @param {Boolean} Should reset flags.
   */
  const _setStartTime = (time, isResetFlags = true ) => {
    // reset flags
    if (isResetFlags) {
      isCompleted = isRepeatCompleted = isStarted = false;
    }
    // set start time to passed time or to the current moment
    const startSpot = (time === undefined) ? performance.now() : time;
    // calculate bounds
    // - negativeShift is negative delay in options object
    // - shift time is shift of the parent
    startTime = startSpot + $delay + negativeShift + $shiftTime;
    // because `startTime` is shifted on `$delay` => remocve one `$delay`
    // from the $repeatTime
    endTime = startTime + ($repeatTime - $delay);
    // set play time to the startTimes
    // if playback controls are used - use _resumeTime as play time,
    // else use shifted startTime -- shift is needed for timelines append chains
    playTime = (resumeTime !== undefined) ? resumeTime : startTime + $shiftTime;
    this._resumeTime = undefined;
  }

  /**
   * _subPlay - Method to launch play. Used as launch
   * method for bothplay and reverse methods.
   *
   * @private
   * @param {Number} Shift time in milliseconds.
   * @param {String} Play or reverse state.
   * @return {Object} Self.
   */
  const _subPlay = (shift = 0, state) => {
    // check if direction of playback changes,
    // if so, the _progressTime needs to be flipped
    const isPause = state === 'pause';
    const isPlay = state === 'play';
    const isReverse = state === 'reverse';

    const wasPlay = (isPlay || (isPause && prevState === 'play'));
    const wasReverse = (isReverse || (isPause && prevState === 'reverse'));
    const isFlip = (wasPlay && isReverse) || (wasReverse && isPlay);

    // if tween was ended, set progress to 0 if not, set to elapsed progress
    progressTime = (progressTime >= repeatTime) ? 0 : progressTime;
    // flip the _progressTime if playback direction changed
    if (isFlip) { progressTime = repeatTime - progressTime; }
    // set resume time and normalize prev/start times
    _setResumeTime(state, shift);
    // add self to tweener = play
    tweener.add(this);
  }

  /**
   * _setResumeTime - Method to set _resumeTime, _startTime and _prevTime.
   *
   * @private
   * @param {String} Current state. ['play', 'reverse']
   * @param {Number} Time shift.
   */
  const _setResumeTime = (state, shift = 0) => {
    // get current moment as resume time
    resumeTime = performance.now();
    // set start time regarding passed `shift` and `procTime`
    const startTime = resumeTime - Math.abs(shift) - progressTime;
    _setStartTime(startTime, false);
    // if we have prevTime - we need to normalize
    // it for the current resume time
    if (prevTime !== undefined) {
      prevTime = (state === 'play')
                  // recalculate prevTime for forward direction.
                  ? startTime + progressTime - $delay
                  : endTime - progressTime;
    }
  }

  /**
   * Method to handle tween's progress in inactive area.
   *
   * @private
   * @param {Number} Current update time.
   */
  const _updateInInactiveArea = (time) => {
    if (!isInActiveArea) { return; }
    // complete if time is larger then end time
    if (time > endTime && !isCompleted) {
      _progress(1, time);
      // get period number
      const T = this._getPeriod( p.endTime );
      const isYoyo = $isYoyo && (T % 2 === 0);

      _setProgress((isYoyo) ? 0 : 1, time, isYoyo);
      _repeatComplete(time, isYoyo);
      _complete( time, isYoyo);
    }
    // if was active and went to - inactive area "-"
    if (time < prevTime && time < startTime && !isStarted && !_isCompleted) {
      // if was in active area and didn't fire onStart callback
      _progress( 0, time, false );
      _setProgress( 0, time, false );
      isRepeatStart = false;
      _repeatStart( time, false );
      _start( time, false );
    }
    isInActiveArea = false;
  }

  /**
   * _update - Method to update tween's progress.
   *
   * @private
   * @param {Number} Current update time.
   * -- next params only present when parent Timeline calls the method.
   * @param {Number} Previous Timeline's update time.
   * @param {Boolean} Was parent in yoyo period.
   * @param {Number} [-1, 0, 1] If update is on edge.
   *              -1 = edge jump in negative direction.
   *               0 = no edge jump.
   *               1 = edge jump in positive direction.
   */
  const _update = (time, timelinePrevTime, wasYoyo, onEdge) => {
    // if we don't the _prevTime thus the direction we are heading to,
    // but prevTime was passed thus we are child of a Timeline
    // set _prevTime to passed one and pretent that there was unknown
    // update to not to block start/complete callbacks
    if (prevTime === undefined && timelinePrevTime !== undefined) {
      if ($speed && playTime) {
        // play point + ( speed * delta )
        prevTime = playTime + ($speed * (timelinePrevTime - playTime));
      }
      wasUknownUpdate = true;
    }

    const startPoint = startTime - $delay;
    // if speed param was defined - calculate
    // new time regarding speed
    if ($speed && playTime) {
      // play point + (speed * delta)
      time = playTime + ($speed * (time - playTime));
    }

    // due to javascript precision issues, after speed mapping
    // we can get very close number that was made from progress of 1
    // and in fact represents `endTime` if so, set the time to `endTime`
    if ( Math.abs(endTime - time) < 0.00000001 ) { time = endTime; }

    // if parent is onEdge but not very start nor very end
    if (onEdge && wasYoyo !== undefined)  {
      const T = _getPeriod(time);
      const isYoyo = !!($isYoyo && $repeat && (T % 2 === 1));

      // for timeline
      // notify children about edge jump
      if (timelines) {
        for (var i = 0; i < timelines.length; i++) {
          timelines[i]._update(time, timelinePrevTime, wasYoyo, onEdge);
        }
      }

      // forward edge direction
      if (onEdge === 1) {
        // jumped from yoyo period?
        if (wasYoyo) {
          prevTime = time + 1;
          _repeatStart(time, isYoyo);
          _start(time, isYoyo);
        } else {
          prevTime = time - 1;
          _repeatComplete(time, isYoyo);
          _complete(time, isYoyo);
        }
      // backward edge direction
      } else if (onEdge === -1) {
        // jumped from yoyo period?
        if (wasYoyo) {
          prevTime = time - 1;
          _repeatComplete( time, isYoyo );
          _complete( time, isYoyo );
        } else {
          // call _start callbacks only if prev time was in active area
          // not always true for append chains
          if (prevTime >= startTime && prevTime <= endTime) {
            prevTime = time + 1;
            _repeatStart(time, isYoyo);
            _start(time, isYoyo);
            // reset isCompleted immediately to prevent onComplete cb
            isCompleted = true;
          }
        }
      }
      // reset the _prevTime - drop one frame to undestand
      // where we are heading
      prevTime = undefined;
    }
    // if in active area and not ended - save progress time
    // for pause/play purposes.
    if (time > startPoint && time < endTime) {
      progressTime = time - startPoint;
    }
    // else if not started or ended set progress time to 0
    else if (time <= startPoint) { progressTime = 0; }
    else if (time >= endTime) {
      // set progress time to repeat time + tiny cofficient
      // to make it extend further than the end time
      progressTime = repeatTime + .00000000001;
    }
    // reverse time if _props.isReversed is set
    if (isReversed) { time = endTime - progressTime; }
    // We need to know what direction we are heading to,
    // so if we don't have the previous update value - this is very first
    // update, - skip it entirely and wait for the next value
    if (prevTime === undefined) {
      prevTime = time;
      wasUknownUpdate = true;
      return false;
    }

    // ====== AFTER SKIPPED FRAME ======

    // handle onProgress callback
    if (time >= startPoint && time <= endTime) {
      _progress((time - startPoint) / repeatTime, time);
    }
    /*
      if time is inside the active area of the tween.
      active area is the area from start time to end time,
      with all the repeat and delays in it
    */
    if ((time >= startTime) && (time <= endTime)) {
      _updateInActiveArea(time);
    } else {
      // if was in active area - update in inactive area but just once -
      // right after the active area
      if (isInActiveArea) { _updateInInactiveArea(time); }
      else if (!isRefreshed) {
        // onRefresh callback
        // before startTime
        if (time < startTime && progress !== 0) {
          _refresh( true );
          isRefreshed = true;
        }
      }
    }

    prevTime = time;
    return (time >= endTime) || (time <= startPoint);
  }

  /**
   * _setPlaybackState - Method set playback state string.
   *
   * @private
   * @param {String} State name.
   */
  const _setPlaybackState = (stateName) => {
    // save previous state
    prevState = state;
    state = stateName;

    const wasPause   = prevState === 'pause';
    const wasPlaying = prevState === 'play' || prevState === 'reverse';
    const wasStill   = prevState === 'stop' || wasPause;

    if ((state === 'play' || state === 'reverse') && wasStill) {
      _playbackStart();
    }
    if (state === 'pause' && wasPlaying) { _playbackPause(); }
    if (state === 'stop' && (wasPlaying || wasPause)) { _playbackStop(); }
  }

  /***** Public Methods *****/

  /**
   * play - API method to play the Tween.
   *
   * @public
   * @param  {Number} Shift time in milliseconds.
   * @return {Object} Self.
   */
  const play = (shift = 0) => {
    if (state === 'play' && isRunning) { return tween; }
    isReversed = false;
    subPlay(shift, 'play');
    setPlaybackState('play');
    return tween;
  }

  /**
   * playBackward - API method to play the Tween in reverse.
   *
   * @public
   * @param  {Number} Shift time in milliseconds.
   * @return {Object} Self.
   */
  const playBackward = (shift = 0) => {
    if (state === 'reverse' && isRunning) { return tween; }
    isReversed = true;
    subPlay(shift, 'reverse');
    setPlaybackState('reverse');
    return tween;
  }

  /**
   * pause - API method to pause Tween.
   *
   * @public
   * @returns {Object} Self.
   */
  const pause = () => {
    if (state === 'pause' || state === 'stop')  { return tween; }
    removeFromTweener();
    setPlaybackState('pause');
    return tween;
  }

  /**
   * stop - API method to stop the Tween.
   *
   * @public
   * @param   {Number} Progress [0..1] to set when stopped.
   * @returns {Object} Self.
   */
  const stop = (progress) => {
    if ( state === 'stop' ) { return tween; }
    // reset to initial `wasUknownUpdate`
    wasUknownUpdate = undefined;

    const stopProc = (progress !== undefined) ? progress
      // if no progress passsed - set to `1` if `tween`
      // is `playingBackward`, otherwise set to `0`
      : ( state === 'reverse' ) ? 1 : 0

    setProgress(stopProc);
    reset();
    return tween;
  }

  /**
   * replay - API method to replay(restart) the Tween.
   *
   * @public
   @param   {Number} Shift time in milliseconds.
   @returns {Object} Self.
   */
  const replay = (shift = 0) => {
    // reset the `tween`
    reset();
    // play it
    play(shift);
    return tween;
  }

  /**
   * replayBackward - API method to replay(restart) backward the Tween.
   *
   * @public
   * @param   {Number} Shift time in milliseconds.
   * @returns {Object} Self.
   */
  const replayBackward = (shift = 0) => {
    // reset the tween
    reset();
    // play it backward
    playBackward(shift);
    return tween;
  }

  /**
   * resume - API method to resume the Tween.
   *
   * @public
   * @param  {Number} Shift time in milliseconds.
   * @return {Object} Self.
   */
  const resume = (shift = 0) => {
    if ( state !== 'pause' ) { return tween; }

    switch (prevState) {
      // if `prevState` was `play` - play it
      case 'play':
        play(shift);
        break;
      case 'reverse':
        // if `prevState` was `reverse` - play it backward
        playBackward(shift);
        break;
    }

    return tween;
  }

  /**
   * setProgress - API method to set progress on tween.
   *
   * @public
   * @param {Number} Progress to set.
   * @returns {Object} Self.
   */
  const setProgress = (progress) => {
    // set start time if there is no one yet.
    startTime && setStartTime();
    // reset play time, because we `seek` the tween
    playTime = undefined;
    // progress should be in range of [0..1]
    ( progress < 0 ) && ( progress = 0 );
    ( progress > 1 ) && ( progress = 1 );
    // update self with calculated time
    update((startTime - $delay) + progress*repeatTime);
    return tween;
  }

  /**
   * setSpeed - Method to set tween's speed.
   *
   * @public
   * @param {Number} Speed value.
   * @returns this.
   */
  const setSpeed = (speed = 1) => {
    $speed = speed;
    // if playing - normalize _startTime and _prevTime to the current point.
    if ( state === 'play' || state === 'reverse' ) { setResumeTime( state ); }
    return tween;
  }

  /**
   * reset - Method to reset tween's state and properties.
   *
   * @public
   * @returns this.
   */
  const reset = () => {
    removeFromTweener();
    setPlaybackState('stop');
    progressTime     = 0;
    isCompleted      = false;
    isStarted        = false;
    isFirstUpdate    = false;
    wasUknownUpdate  = undefined;
    prevTime         = undefined;
    isPrevYoyo         = undefined;
    isReversed       = false;
    return tween;
  }

  /**
   * Expose public methods:
   */
  tween.play = play;
  tween.playBackward = playBackward;
  tween.pause = pause;
  tween.resume = resume;
  tween.stop = stop;
  tween.replay = replay;
  tween.setProgress = setProgress;
  tween.setSpeed = setSpeed;
  tween.reset = reset;

  return tween;
}
