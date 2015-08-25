'use strict';

var $               = window.$;
var _               = require('underscore');
var Rx              = require('rx');
                      require('../rx-jquery-stub');
var util            = require('./util.js');
var Color           = require('color');


//$DOM * hex -> Observable hex
function makeInspector ($elt, hexColor) {

    var colors = new Rx.Subject();

    $elt.find('.colorSelector').ColorPicker({
        color: hexColor,
        onShow: function (colpkr) {
            $(colpkr).fadeIn(500);
            return false;
        },
        onHide: function (colpkr) {
            $(colpkr).fadeOut(500);
            return false;
        },
        onChange: function (hsb, hex, rgb) {
            $elt.find('.colorSelector div').css('backgroundColor', '#' + hex);
            var color = new Color(rgb);
            colors.onNext(color);
        }
    });

    return colors;
}


function renderConfigValueForColor(colorValue, existingRenderConfigValue) {
    return _.map(colorValue.rgbaArray(), function (value, index) {
        // Unspecified alpha => opaque
        if (index === 3 && value === undefined) {
            // Unspecified alpha + existing alpha => retain alpha
            if (existingRenderConfigValue && existingRenderConfigValue[3]) {
                return existingRenderConfigValue[3];
            }
            return 1;
        }
        return value / 255;
    });
}


function colorFromRenderConfigValue(rgbaFractions) {
    var rgbaBytes = _.map(rgbaFractions, function (value) {
        return value * 255;
    }),
        result = new Color();
    result.rgb(rgbaBytes.slice(0, 3)).alpha(rgbaBytes[3]);
    return result;
}


/**
 *
 * @param {HTMLElement} $fg - Element for the foreground color button affordance.
 * @param {HTMLElement} $bg - Element for the background color button affordance.
 * @param {Socket} socket - socket or proxy
 * @param {RenderState} renderState
 */
module.exports = {
    init: function ($fg, $bg, foregroundColorObservable, backgroundColorObservable, socket, renderState) {

        foregroundColorObservable.first()
            .subscribe(function (initForegroundColor) {
                makeInspector($fg, initForegroundColor.hexString())
                    .throttleFirst(10)
                    .do(function (foregroundColor) {
                        // Execute the server command:
                        socket.emit('set_colors', {
                            rgb: {
                                r: foregroundColor.red(),
                                g: foregroundColor.green(),
                                b: foregroundColor.blue(),
                                a: foregroundColor.alpha()
                            }
                        });
                        // Update the color picker swatch affordance:
                        $('.colorSelector div', $fg).css('background-color', foregroundColor.hexString());
                    })
                    .subscribe(foregroundColorObservable, util.makeErrorHandler('bad foreground color'));
            });

        backgroundColorObservable.first()
            .subscribe(function (initBackgroundColor) {
                makeInspector($bg, initBackgroundColor.hexString())
                    .throttleFirst(10)
                    .do(function (backgroundColor) {
                        // Set the background color directly/locally via CSS:
                        $('#simulation').css('backgroundColor', backgroundColor.rgbaString());
                        // Update the server render config:
                        var newValue = renderConfigValueForColor(backgroundColor, renderState.get('options').clearColor);
                        socket.emit('update_render_config', {'options': {'clearColor': [newValue]}});
                        // Update the color picker swatch affordance:
                        $('.colorSelector div', $bg).css('background-color', backgroundColor.hexString());
                    })
                    .subscribe(backgroundColorObservable, util.makeErrorHandler('bad background color'));
            });
    },

    makeInspector: makeInspector,

    colorFromRenderConfigValue: colorFromRenderConfigValue,

    renderConfigValueForColor: renderConfigValueForColor,

    foregroundColorObservable: function () {
        var foregroundColorObservable = new Rx.ReplaySubject(1);
        var blackForegroundDefault = (new Color()).rgb(0, 0, 0);
        foregroundColorObservable.onNext(blackForegroundDefault);
        return foregroundColorObservable;
    },

    backgroundColorObservable: function (initialRenderState, urlParams) {
        var backgroundColorObservable = new Rx.ReplaySubject(1);
        var renderStateBackgroundColor = colorFromRenderConfigValue(initialRenderState.get('options').clearColor[0]);
        var urlParamsBackgroundColor;
        if (urlParams.hasOwnProperty('bg')) {
            try {
                var hex = decodeURIComponent(urlParams.bg);
                urlParamsBackgroundColor = new Color(hex);
                var configValueForColor = renderConfigValueForColor(urlParamsBackgroundColor, renderStateBackgroundColor);
                initialRenderState.get('options').clearColor = [configValueForColor];
            } catch (e) {
                console.error('Invalid color from URL', e, urlParams.bg);
            }
        }
        backgroundColorObservable.onNext(renderStateBackgroundColor);
        return backgroundColorObservable;
    }
};
