import {Component, Suspense, type ReactNode} from 'react';
import type {UiContext} from '../i18n/context';
import {Action, Notice} from '../ui/controls';

class LoadBoundary extends Component<{ui:UiContext;children:ReactNode},{failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() {return {failed:true};}
  render() {
    if (this.state.failed) return <div className="stack">
      <Notice error>{this.props.ui.t('featureLoadFailed')}</Notice>
      <Action ui={this.props.ui} label="reloadPage" symbol="refresh" variant="outline" onClick={()=>location.reload()} />
    </div>;
    return this.props.children;
  }
}

export function FeatureBoundary({ui,children}:{ui:UiContext;children:ReactNode}) {
  return <LoadBoundary ui={ui}><Suspense fallback={<Notice>{ui.t('loading')}</Notice>}>{children}</Suspense></LoadBoundary>;
}
