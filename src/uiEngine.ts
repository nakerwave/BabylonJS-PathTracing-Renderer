import Stats from 'stats.js';
import { PathTracingEngine } from './pathTracingEngine';

/**
 * Manage all Ui to play with rendering parameters
 */

export class UiEngine extends PathTracingEngine {

    constructor() {
        super();
        this.addStat();

        window.addEventListener("resize", this.onWindowResize);
    }

    statUi: Stats;
    addStat () {
        this.statUi = new Stats();
        this.statUi.domElement.style.position = 'absolute';
        this.statUi.domElement.style.top = '0px';
        this.statUi.domElement.style.cursor = "default";
        this.statUi.domElement.style.webkitUserSelect = "none";
        this.statUi.domElement.style.MozUserSelect = "none";
        this.container.appendChild(this.statUi.domElement);

        this.screenOutputScene.registerAfterRender(() => {
            this.statUi.update();
        })
    }

    onWindowResize(event) {
        this.engine.resize();
    }

}
