import { toProps } from '@graphistry/falcor';
import { Labels } from 'viz-shared/containers/labels';
import { Renderer } from 'viz-shared/containers/renderer';
import { Settings } from 'viz-shared/containers/settings';
import { container } from '@graphistry/falcor-react-redux';
import { Selection } from 'viz-shared/containers/selection';
import SceneComponent from 'viz-shared/components/scene';

let Scene = ({
    onPointSelected,
    id, simulating, labels = {},
    renderer = {}, highlight = {},
    selection = {}, ...props } = {}) => {
    return (
        <SceneComponent selection={selection}
                        simulating={simulating}
                        sceneID={id} {...props}>
            <Renderer key='renderer'
                      data={renderer}
                      simulating={simulating}/>
            <Selection key='highlight'
                       data={highlight}
                       simulating={simulating}/>
            <Selection key='selection'
                       data={selection}
                       simulating={simulating}
                       onPointSelected={onPointSelected}/>
            <Labels key='labels'
                    data={labels}
                    simulating={simulating}/>
        </SceneComponent>
    );
};

Scene = container((scene = {}) => {
    return `{
        id, simulating,
        ... ${ Settings.fragment(scene) },
        labels: ${ Labels.fragment(scene.labels) },
        renderer: ${ Renderer.fragment(scene.renderer) },
        highlight: ${ Selection.fragment(scene.highlight) },
        selection: ${ Selection.fragment(scene.selection) }
    }`;
})(Scene);

export { Scene };