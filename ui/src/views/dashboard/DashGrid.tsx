import React, { PureComponent } from 'react';
import _ from 'lodash'
import ReactGridLayout, { ItemCallback } from 'react-grid-layout';
import sizeMe from 'react-sizeme';
import classNames from 'classnames';
import {PanelModel,panelAdded,panelRemoved} from './model/PanelModel'
import {DashboardModel} from './model/DashboardModel'
import { GRID_CELL_HEIGHT, GRID_CELL_VMARGIN, GRID_COLUMN_COUNT } from 'src/core/constants';
import PanelWrapper from './PanelWrapper'
import {AddPanelWidget} from './components/AddPanelWidget/AddPanelWidget'
import {DashboardRow} from './components/Row/Row'

import './DashGrid.less'
import { CoreEvents } from 'src/types';
import { getVariable } from '../variables/state/selectors';

interface GridWrapperProps {
    size: { width: number };
    layout: ReactGridLayout.Layout[];
    onLayoutChange: (layout: ReactGridLayout.Layout[]) => void;
    children: JSX.Element | JSX.Element[];
    onDragStop: ItemCallback;
    onResize: ItemCallback;
    onResizeStop: ItemCallback;
    onWidthChange: () => void;
    className: string;
    isResizable?: boolean;
    isDraggable?: boolean;
    viewPanel: PanelModel | null;
  }

  let lastGridWidth = 1200;
let ignoreNextWidthChange = false;
  function GridWrapper({
    size,
    layout,
    onLayoutChange,
    children,
    onDragStop,
    onResize,
    onResizeStop,
    onWidthChange,
    className,
    isResizable,
    isDraggable,
    viewPanel
  }: GridWrapperProps) {
    const width = size.width > 0 ? size.width : lastGridWidth;
  
    // logic to ignore width changes (optimization)
    if (width !== lastGridWidth) {
      if (ignoreNextWidthChange) {
        ignoreNextWidthChange = false;
      } else if (!viewPanel && Math.abs(width - lastGridWidth) > 8) {
        onWidthChange();
        lastGridWidth = width;
      }
    }
  
    /*
      Disable draggable if mobile device, solving an issue with unintentionally
       moving panels.
    */
    const draggable = width <= 420 ? false : isDraggable;
  
    return (
      <ReactGridLayout
        width={lastGridWidth}
        className={className}
        isDraggable={draggable}
        isResizable={isResizable}
        containerPadding={[0, 0]}
        useCSSTransforms={false}
        margin={[GRID_CELL_VMARGIN, GRID_CELL_VMARGIN]}
        cols={GRID_COLUMN_COUNT}
        rowHeight={GRID_CELL_HEIGHT}
        draggableHandle=".grid-drag-handle"
        layout={layout}
        onResize={onResize}
        onResizeStop={onResizeStop}
        onDragStop={onDragStop}
        onLayoutChange={onLayoutChange}
      >
        {children}
      </ReactGridLayout>
    );
  }

const SizedReactLayoutGrid = sizeMe({ monitorWidth: true })(GridWrapper);

export interface Props {
  dashboard: DashboardModel;
  viewPanel: PanelModel | null;
  scrollTop: number;
  isPanelEditorOpen?: boolean;
  alertStates: any
}

export class DashboardGrid extends PureComponent<Props> {
    panelMap: { [id: string]: PanelModel };
    panelRef: { [id: string]: HTMLElement } = {};

    componentDidMount() {
      const { dashboard } = this.props;
      dashboard.on(panelAdded, this.triggerForceUpdate);
      dashboard.on(panelRemoved, this.triggerForceUpdate);
      dashboard.on(CoreEvents.repeatsProcessed, this.triggerForceUpdate);
      dashboard.on(CoreEvents.rowCollapsed, this.triggerForceUpdate);
      dashboard.on(CoreEvents.rowExpanded, this.triggerForceUpdate);
    }
  
    componentWillUnmount() {
      const { dashboard } = this.props;
      dashboard.off(panelAdded, this.triggerForceUpdate);
      dashboard.off(panelRemoved, this.triggerForceUpdate);
      dashboard.off(CoreEvents.repeatsProcessed, this.triggerForceUpdate);
      dashboard.off(CoreEvents.rowCollapsed, this.triggerForceUpdate);
      dashboard.off(CoreEvents.rowExpanded, this.triggerForceUpdate);
    }
  
    buildLayout(panels) {
      const layout = [];
      this.panelMap = {};
  
      for (const panel of panels) {
        const stringId = panel.id.toString();
        this.panelMap[stringId] = panel;
  
        if (!panel.gridPos) {
          console.log('panel without gridpos');
          continue;
        }
  
        const panelPos: any = {
          i: stringId,
          x: panel.gridPos.x,
          y: panel.gridPos.y,
          w: panel.gridPos.w,
          h: panel.gridPos.h,
        };
  
        if (panel.type === 'row') {
          panelPos.w = GRID_COLUMN_COUNT;
          panelPos.h = 1;
          panelPos.isResizable = false;
          panelPos.isDraggable = panel.collapsed;
        }
  
        layout.push(panelPos);
      }
  
      return layout;
    }
  
    onLayoutChange = (newLayout: ReactGridLayout.Layout[]) => {
      for (const newPos of newLayout) {
        this.panelMap[newPos.i!].updateGridPos(newPos);
      }
  
      this.props.dashboard.sortPanelsByGridPos();
  
      // Call render() after any changes.  This is called when the layour loads
      this.forceUpdate();
    };
  
    triggerForceUpdate = () => {
      this.forceUpdate();
    };
  
    onWidthChange = () => {
      for (const panel of this.props.dashboard.panels) {
        panel.resizeDone();
      }
    };
  
    updateGridPos = (item: ReactGridLayout.Layout, layout: ReactGridLayout.Layout[]) => {
      this.panelMap[item.i!].updateGridPos(item);
  
      // react-grid-layout has a bug (#670), and onLayoutChange() is only called when the component is mounted.
      // So it's required to call it explicitly when panel resized or moved to save layout changes.
      this.onLayoutChange(layout);
    };
  
    onResize: ItemCallback = (layout, oldItem, newItem) => {
      this.panelMap[newItem.i!].updateGridPos(newItem);
    };
  
    onResizeStop: ItemCallback = (layout, oldItem, newItem) => {
      this.updateGridPos(newItem, layout);
      this.panelMap[newItem.i!].resizeDone();
    };
  
    onDragStop: ItemCallback = (layout, oldItem, newItem) => {
      this.updateGridPos(newItem, layout);
    };
  
    isInView = (panel: PanelModel): boolean => {
      if (panel.isViewing || panel.isEditing) {
        return true;
      }
  
      // elem is set *after* the first render
      const elem = this.panelRef[panel.id.toString()];
      if (!elem) {
        // NOTE the gridPos is also not valid until after the first render
        // since it is passed to the layout engine and made to be valid
        // for example, you can have Y=0 for everything and it will stack them
        // down vertically in the second call
        return false;
      }
  
      const top = elem.offsetTop;
      const height = panel.gridPos.h * GRID_CELL_HEIGHT + 40;
      const bottom = top + height;
  
      // Show things that are almost in the view
      const buffer = 250;
  
      const viewTop = this.props.scrollTop;
      if (viewTop > bottom + buffer) {
        return false; // The panel is above the viewport
      }
  
      // Use the whole browser height (larger than real value)
      // TODO? is there a better way
      const viewHeight = isNaN(window.innerHeight) ? (window as any).clientHeight : window.innerHeight;
      const viewBot = viewTop + viewHeight;
      if (top > viewBot + buffer) {
        return false;
      }
      
      return !this.props.dashboard.otherPanelInFullscreen(panel);
    };
  
    renderPanels(panels) {
      const panelElements = [];
      for (const panel of panels) {  
        const panelClasses = classNames({ 'react-grid-item--fullscreen': panel.isViewing });
        const id = panel.id.toString();
        panel.isInView = this.isInView(panel);
        panelElements.push(
          <div key={id} className={panelClasses} id={'panel-' + id} ref={elem => elem && (this.panelRef[id] = elem)}>
            {this.renderPanel(panel)}
          </div>
        );
      }
      
      return panelElements;
    }
  
    renderPanel(panel: PanelModel) {
      const alertState = this.props.alertStates[panel.id]
      if (panel.type === 'row') {
        return <DashboardRow panel={panel} dashboard={this.props.dashboard} />;
      }
  
      if (panel.type === 'add-panel') {
        return <AddPanelWidget panel={panel} dashboard={this.props.dashboard} />;
      }
      
      return (
        <PanelWrapper
          panel={panel}
          dashboard={this.props.dashboard}
          isEditing={panel.isEditing}
          isViewing={panel.isViewing}
          isInView={panel.isInView}
          alertState={alertState}
        />
      );
    }
  
    render() {
      const { dashboard, viewPanel } = this.props;
      const panels = []
      for (const panel of dashboard.panels) {
        let canRender = true 
        try {
          const renderConditions:string[] = JSON.parse(panel.renderCondition)
          if (renderConditions.length === 2) {
            const v = getVariable(renderConditions[0])
            //@ts-ignore
            if (v.current.value === renderConditions[1]) {
              canRender = true
            } else {
              canRender = false
            }
          }
        } catch (error) {
          
        }


        if (canRender) {
          panels.push(panel)
        }
      }
      return (
        <SizedReactLayoutGrid
          className={classNames({ layout: true })} 
          layout={this.buildLayout(panels)}
          isResizable={dashboard.meta.canEdit}
          isDraggable={dashboard.meta.canEdit}
          onLayoutChange={this.onLayoutChange}
          onWidthChange={this.onWidthChange}
          onDragStop={this.onDragStop}
          onResize={this.onResize}
          onResizeStop={this.onResizeStop}
          viewPanel={viewPanel}
        >
          {this.renderPanels(panels)}
        </SizedReactLayoutGrid>
      );
    }
  }