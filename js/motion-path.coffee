h         = require './h'
Tween     = require './tween'
Timeline  = require './timeline'
resize    = require './vendor/resize'

# TODO
#   switch to jasmine 2.0 + add travis ci
#   fix ff callbacks
#   junk?

class MotionPath
  NS: 'http://www.w3.org/2000/svg'
  defaults:
    delay:    0
    duration:         1000
    easing:           null
    repeat:           0
    yoyo:             false
    offsetX:          0
    offsetY:          0
    angleOffset:      null
    pathStart:        0
    pathEnd:          1
    transformOrigin:  null

    isAngle:          false
    isReverse:        false
    isRunLess:        false
    isPresetPosition: true

    onStart:          null
    onComplete:       null
    onUpdate:         null

  constructor:(@o={})->
    @vars()
    if !@props.isRunLess then @run()
    else if @props.isPresetPosition then @setProgress(@props.pathStart)
    @

  vars:->
    @getScaler = h.bind @getScaler, @
    @resize = resize
    @props = h.cloneObj @defaults

    @extendOptions @o
    @props.pathStart = h.clamp @props.pathStart, 0, 1
    @props.pathEnd   = h.clamp @props.pathEnd, @props.pathStart, 1

    # cache the onUpdate method for perf reasons
    @onUpdate = @props.onUpdate

    @postVars()

  postVars:->
    @el         = @parseEl @props.el
    @path       = @getPath()
    @len        = @path.getTotalLength()*@props.pathEnd

    @fill       = @o.fill
    if @fill?
      @container  = @parseEl @props.fill.container
      @fillRule   = @props.fill.fillRule or 'all'
      @getScaler()
      return if !@container
      @removeEvent @container, 'onresize', @getScaler
      @addEvent    @container, 'onresize', @getScaler

  addEvent:(el, type, handler)->
    if el.addEventListener then @container.addEventListener type, handler
    else if el.attachEvent then @container.attachEvent type, handler

  removeEvent:(el, type, handler)->
    if el.removeEventListener
      @container.removeEventListener type, handler
    else if el.detachEvent then @container.detachEvent type, handler

  parseEl:(el)->
    return document.querySelector el if typeof el is 'string'
    return el if el instanceof HTMLElement

  getPath:->
    if typeof @props.path is 'string'
      return if @props.path.charAt(0).toLowerCase() is 'm'
        path = document.createElementNS @NS, 'path'
        path.setAttributeNS(null, 'd', @o.path); path
      else document.querySelector @props.path
    # DOM node
    if @props.path.style
      return @props.path

  getScaler:()->
    @cSize =
      width:  @container.offsetWidth  or 0
      height: @container.offsetHeight or 0

    start = @path.getPointAtLength 0
    end   = @path.getPointAtLength @len

    size = {}
    size.width  = if end.x >= start.x then end.x-start.x else start.x-end.x
    size.height = if end.y >= start.y then end.y-start.y else start.y-end.y

    @scaler = {}

    calcWidth  = =>
      @scaler.x = @cSize.width/size.width
      if !isFinite(@scaler.x) then @scaler.x = 1
    calcHeight = =>
      @scaler.y = @cSize.height/size.height
      if !isFinite(@scaler.y) then @scaler.y = 1
    calcBoth   = -> calcWidth(); calcHeight()

    switch @fillRule
      when 'all'
        calcBoth()
      when 'width'
        calcWidth();  @scaler.y = @scaler.x
      when 'height'
        calcHeight(); @scaler.x = @scaler.y
      else
        calcBoth()

  run:(o)->
    if o?.path then @o.path = o.path
    if o?.el then @o.el = o.el
    if o?.fill then @o.fill = o.fill
    o and @extendDefaults o
    o and @postVars(); it = @

    @timeline = new Timeline
      duration:   @props.duration
      delay:      @props.delay
      yoyo:       @props.yoyo
      repeat:     @props.repeat
      easing:     @props.easing
      onStart:    => @props.onStart?.apply @
      onComplete: => @props.onComplete?.apply @
      onUpdate:   (p)=> @setProgress(p); @onUpdate?(p)
    @tween = new Tween; @tween.add(@timeline); @tween.start()

  setProgress:(p)->
    len = if !@props.isReverse then p*@len else (1-p)*@len
    point = @path.getPointAtLength len
    if @props.isAngle or @props.angleOffset?
      prevPoint = @path.getPointAtLength len - 1
      x1 = point.y - prevPoint.y
      x2 = point.x - prevPoint.x
      atan = Math.atan(x1/x2); !isFinite(atan) and (atan = 0)
      @angle = atan*h.RAD_TO_DEG
      if (typeof @props.angleOffset) isnt 'function'
        @angle += @props.angleOffset or 0
      else @angle = @props.angleOffset(@angle, p)
    else @angle = 0
    
    x = point.x + @props.offsetX; y = point.y + @props.offsetY
    if @scaler then x *= @scaler.x; y *= @scaler.y

    rotate = if @angle isnt 0 then "rotate(#{@angle}deg)" else ''
    transform = "translate(#{x}px,#{y}px) #{rotate} translateZ(0)"
    @el.style["#{h.prefix.css}transform"] = transform
    @el.style['transform'] = transform

    if @props.transformOrigin
      # transform origin could be a function
      tOrigin = if typeof @props.transformOrigin is 'function'
        @props.transformOrigin(@angle, p)
      else @props.transformOrigin
      @el.style["#{h.prefix.css}transform-origin"] = tOrigin
      @el.style['transform-origin'] = tOrigin

  extendDefaults:(o)->
    for key, value of o
      @[key] = value

  extendOptions:(o)->
    for key, value of o
      @props[key] = value

### istanbul ignore next ###
if (typeof define is "function") and define.amd
  define "motion-path", [], -> MotionPath
### istanbul ignore next ###
if (typeof module is "object") and (typeof module.exports is "object")
  module.exports = MotionPath
### istanbul ignore next ###
window?.mojs ?= {}
### istanbul ignore next ###
window?.mojs.MotionPath = MotionPath
