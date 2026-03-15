<script setup lang="ts">
import {
  IonPage, IonHeader, IonToolbar, IonTitle, IonContent, IonBackButton, IonButtons,
  IonButton, IonLabel, IonItem, IonList, IonListHeader, IonInput,
  IonTextarea, IonToggle, IonCheckbox, IonRadio, IonRadioGroup, IonSelect,
  IonSelectOption, IonRange, IonSegment, IonSegmentButton, IonCard, IonCardHeader,
  IonCardTitle, IonCardSubtitle, IonCardContent, IonChip, IonBadge, IonAvatar,
  IonNote, IonSearchbar, IonFab, IonFabButton, IonProgressBar, IonSpinner,
  IonAlert, IonToast, IonActionSheet, IonAccordion, IonAccordionGroup,
  IonItemDivider, IonItemSliding, IonItemOption, IonItemOptions, IonThumbnail,
  IonSkeletonText, IonText,
  alertController, toastController, actionSheetController,
} from '@ionic/vue'
import {
  Heart, Star, Trash2, Share2, Plus, Check, X, User,
  MoreHorizontal, ChevronRight, Bell, Mail,
  MessageSquare, Settings, Wrench, GitBranch, AlertTriangle, Info,
} from 'lucide-vue-next'
import { ref } from 'vue'

const segmentValue = ref('first')
const rangeValue = ref(50)
const toggleValue = ref(true)
const checkboxValue = ref(false)

async function showAlert() {
  const alert = await alertController.create({
    header: 'Alert',
    subHeader: 'Important message',
    message: 'This is an example alert dialog.',
    buttons: ['OK'],
  })
  await alert.present()
}

async function showToast() {
  const toast = await toastController.create({
    message: 'This is a toast notification',
    duration: 2000,
    position: 'bottom',
    color: 'primary',
  })
  await toast.present()
}

async function showActionSheet() {
  const actionSheet = await actionSheetController.create({
    header: 'Actions',
    buttons: [
      { text: 'Delete', role: 'destructive' },
      { text: 'Share' },
      { text: 'Favorite' },
      { text: 'Cancel', role: 'cancel' },
    ],
  })
  await actionSheet.present()
}
</script>

<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/settings" />
        </ion-buttons>
        <ion-title>Component Showcase</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">

      <!-- BUTTONS -->
      <ion-list-header>
        <ion-label>Buttons</ion-label>
      </ion-list-header>
      <div class="showcase-section">
        <ion-button>Default</ion-button>
        <ion-button color="secondary">Secondary</ion-button>
        <ion-button color="success">Success</ion-button>
        <ion-button color="warning">Warning</ion-button>
        <ion-button color="danger">Danger</ion-button>
        <ion-button color="dark">Dark</ion-button>
        <ion-button color="medium">Medium</ion-button>
        <ion-button color="light">Light</ion-button>
      </div>
      <div class="showcase-section">
        <ion-button fill="outline">Outline</ion-button>
        <ion-button fill="clear">Clear</ion-button>
        <ion-button size="small">Small</ion-button>
        <ion-button size="large">Large</ion-button>
        <ion-button :disabled="true">Disabled</ion-button>
      </div>
      <div class="showcase-section">
        <ion-button>
          <Heart :size="18" slot="start" />
          With Icon
        </ion-button>
        <ion-button fill="outline">
          <ChevronRight :size="18" slot="end" />
          Icon End
        </ion-button>
        <ion-button>
          <Star :size="18" slot="icon-only" />
        </ion-button>
      </div>

      <!-- CARDS -->
      <ion-list-header>
        <ion-label>Cards</ion-label>
      </ion-list-header>
      <ion-card>
        <ion-card-header>
          <ion-card-subtitle>Card Subtitle</ion-card-subtitle>
          <ion-card-title>Card Title</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          Here's a small text description for the card content. Nothing more, nothing less.
        </ion-card-content>
        <div class="card-actions">
          <ion-button fill="clear" size="small">Action 1</ion-button>
          <ion-button fill="clear" size="small">Action 2</ion-button>
        </div>
      </ion-card>

      <ion-card color="primary">
        <ion-card-header>
          <ion-card-title>Colored Card</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          This card uses the primary color.
        </ion-card-content>
      </ion-card>

      <!-- CHIPS & BADGES -->
      <ion-list-header>
        <ion-label>Chips & Badges</ion-label>
      </ion-list-header>
      <div class="showcase-section">
        <ion-chip>
          <ion-label>Default</ion-label>
        </ion-chip>
        <ion-chip color="primary">
          <User :size="16" />
          <ion-label>Primary</ion-label>
        </ion-chip>
        <ion-chip color="success">
          <Check :size="16" />
          <ion-label>Success</ion-label>
        </ion-chip>
        <ion-chip color="warning">
          <ion-label>Warning</ion-label>
        </ion-chip>
        <ion-chip color="danger">
          <X :size="16" />
          <ion-label>Danger</ion-label>
        </ion-chip>
        <ion-chip outline>
          <ion-label>Outline</ion-label>
        </ion-chip>
      </div>
      <div class="showcase-section">
        <ion-badge>1</ion-badge>
        <ion-badge color="primary">99+</ion-badge>
        <ion-badge color="success">New</ion-badge>
        <ion-badge color="warning">Pending</ion-badge>
        <ion-badge color="danger">Error</ion-badge>
      </div>

      <!-- LIST / ITEMS -->
      <ion-list-header>
        <ion-label>List Items</ion-label>
      </ion-list-header>
      <ion-list inset>
        <ion-item>
          <User :size="20" slot="start" />
          <ion-label>Simple Item</ion-label>
        </ion-item>
        <ion-item>
          <Mail :size="20" slot="start" />
          <ion-label>
            <h2>Two-Line Item</h2>
            <p>Secondary text goes here</p>
          </ion-label>
          <ion-badge slot="end" color="primary">5</ion-badge>
        </ion-item>
        <ion-item>
          <ion-avatar slot="start">
            <div class="avatar-placeholder">AB</div>
          </ion-avatar>
          <ion-label>
            <h2>Avatar Item</h2>
            <p>With avatar placeholder</p>
          </ion-label>
          <ion-note slot="end">3:42 PM</ion-note>
        </ion-item>
        <ion-item detail>
          <Bell :size="20" slot="start" />
          <ion-label>Detail Arrow</ion-label>
        </ion-item>
      </ion-list>

      <!-- SLIDING ITEMS -->
      <ion-list-header>
        <ion-label>Sliding Items</ion-label>
      </ion-list-header>
      <ion-list inset>
        <ion-item-sliding>
          <ion-item>
            <ion-label>
              <h2>Slide me left</h2>
              <p>Swipe to reveal actions</p>
            </ion-label>
          </ion-item>
          <ion-item-options side="end">
            <ion-item-option color="danger">
              <Trash2 :size="20" slot="icon-only" />
            </ion-item-option>
            <ion-item-option color="primary">
              <Share2 :size="20" slot="icon-only" />
            </ion-item-option>
          </ion-item-options>
        </ion-item-sliding>
      </ion-list>

      <!-- ACCORDION -->
      <ion-list-header>
        <ion-label>Accordion</ion-label>
      </ion-list-header>
      <ion-accordion-group>
        <ion-accordion value="first">
          <ion-item slot="header">
            <ion-label>First Accordion</ion-label>
          </ion-item>
          <div class="ion-padding" slot="content">
            Content for the first accordion section. This can contain any elements.
          </div>
        </ion-accordion>
        <ion-accordion value="second">
          <ion-item slot="header">
            <ion-label>Second Accordion</ion-label>
          </ion-item>
          <div class="ion-padding" slot="content">
            Content for the second accordion section.
          </div>
        </ion-accordion>
        <ion-accordion value="third">
          <ion-item slot="header">
            <ion-label>Third Accordion</ion-label>
          </ion-item>
          <div class="ion-padding" slot="content">
            Content for the third accordion section.
          </div>
        </ion-accordion>
      </ion-accordion-group>

      <!-- FORM INPUTS -->
      <ion-list-header>
        <ion-label>Form Inputs</ion-label>
      </ion-list-header>
      <div class="showcase-section form-inputs">
        <ion-input label="Text Input" label-placement="stacked" fill="outline" placeholder="Enter text" />
        <ion-input label="Email" label-placement="stacked" fill="outline" type="email" placeholder="user@example.com" />
        <ion-input label="Password" label-placement="stacked" fill="outline" type="password" placeholder="••••••••" />
        <ion-input label="Disabled" label-placement="stacked" fill="outline" :disabled="true" value="Can't edit this" />
        <ion-textarea label="Textarea" label-placement="stacked" fill="outline" placeholder="Enter long text..." :rows="3" />
      </div>

      <!-- SEARCHBAR -->
      <ion-list-header>
        <ion-label>Searchbar</ion-label>
      </ion-list-header>
      <ion-searchbar placeholder="Search workflows..." />

      <!-- SELECT -->
      <ion-list-header>
        <ion-label>Select</ion-label>
      </ion-list-header>
      <div class="showcase-section form-inputs">
        <ion-select label="LLM Provider" label-placement="stacked" fill="outline" placeholder="Choose one">
          <ion-select-option value="anthropic">Anthropic</ion-select-option>
          <ion-select-option value="openai">OpenAI</ion-select-option>
          <ion-select-option value="ollama">Ollama (Local)</ion-select-option>
        </ion-select>
      </div>

      <!-- TOGGLES & CHECKBOXES -->
      <ion-list-header>
        <ion-label>Toggles, Checkboxes & Radio</ion-label>
      </ion-list-header>
      <ion-list inset>
        <ion-item>
          <ion-toggle v-model="toggleValue">Enable notifications</ion-toggle>
        </ion-item>
        <ion-item>
          <ion-toggle :disabled="true">Disabled toggle</ion-toggle>
        </ion-item>
        <ion-item>
          <ion-checkbox v-model="checkboxValue">Accept terms</ion-checkbox>
        </ion-item>
      </ion-list>

      <ion-list inset>
        <ion-radio-group value="option1">
          <ion-item>
            <ion-radio value="option1">Option 1</ion-radio>
          </ion-item>
          <ion-item>
            <ion-radio value="option2">Option 2</ion-radio>
          </ion-item>
          <ion-item>
            <ion-radio value="option3">Option 3</ion-radio>
          </ion-item>
        </ion-radio-group>
      </ion-list>

      <!-- RANGE -->
      <ion-list-header>
        <ion-label>Range Slider</ion-label>
      </ion-list-header>
      <ion-list inset>
        <ion-item>
          <ion-range v-model="rangeValue" :min="0" :max="100" :pin="true" label="Temperature" label-placement="stacked" />
        </ion-item>
      </ion-list>

      <!-- SEGMENT -->
      <ion-list-header>
        <ion-label>Segment</ion-label>
      </ion-list-header>
      <ion-segment v-model="segmentValue" mode="ios">
        <ion-segment-button value="first">
          <ion-label>Chat</ion-label>
        </ion-segment-button>
        <ion-segment-button value="second">
          <ion-label>Cowork</ion-label>
        </ion-segment-button>
        <ion-segment-button value="third">
          <ion-label>Workflow</ion-label>
        </ion-segment-button>
      </ion-segment>

      <!-- PROGRESS & SPINNERS -->
      <ion-list-header>
        <ion-label>Progress & Spinners</ion-label>
      </ion-list-header>
      <div class="showcase-section">
        <ion-progress-bar :value="0.4" />
      </div>
      <div class="showcase-section">
        <ion-progress-bar type="indeterminate" />
      </div>
      <div class="showcase-section spinners">
        <ion-spinner name="crescent" />
        <ion-spinner name="dots" />
        <ion-spinner name="circular" />
        <ion-spinner name="lines" />
        <ion-spinner name="bubbles" />
      </div>

      <!-- SKELETON TEXT -->
      <ion-list-header>
        <ion-label>Skeleton Loading</ion-label>
      </ion-list-header>
      <ion-list inset>
        <ion-item>
          <ion-avatar slot="start">
            <ion-skeleton-text :animated="true" />
          </ion-avatar>
          <ion-label>
            <h2><ion-skeleton-text :animated="true" style="width: 60%" /></h2>
            <p><ion-skeleton-text :animated="true" style="width: 80%" /></p>
          </ion-label>
        </ion-item>
        <ion-item>
          <ion-avatar slot="start">
            <ion-skeleton-text :animated="true" />
          </ion-avatar>
          <ion-label>
            <h2><ion-skeleton-text :animated="true" style="width: 50%" /></h2>
            <p><ion-skeleton-text :animated="true" style="width: 70%" /></p>
          </ion-label>
        </ion-item>
      </ion-list>

      <!-- TEXT COLORS -->
      <ion-list-header>
        <ion-label>Typography & Colors</ion-label>
      </ion-list-header>
      <div class="showcase-section typography">
        <h1>Heading 1</h1>
        <h2>Heading 2</h2>
        <h3>Heading 3</h3>
        <p>Regular paragraph text with <strong>bold</strong> and <em>italic</em> styles.</p>
        <ion-text color="primary"><p>Primary text color</p></ion-text>
        <ion-text color="success"><p>Success text color</p></ion-text>
        <ion-text color="warning"><p>Warning text color</p></ion-text>
        <ion-text color="danger"><p>Danger text color</p></ion-text>
        <ion-text color="medium"><p>Medium text color</p></ion-text>
      </div>

      <!-- DIALOGS & OVERLAYS -->
      <ion-list-header>
        <ion-label>Dialogs & Overlays</ion-label>
      </ion-list-header>
      <div class="showcase-section">
        <ion-button @click="showAlert">Show Alert</ion-button>
        <ion-button @click="showToast">Show Toast</ion-button>
        <ion-button @click="showActionSheet">Action Sheet</ion-button>
      </div>

      <!-- FAB -->
      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button>
          <Plus :size="24" />
        </ion-fab-button>
      </ion-fab>

      <div style="height: 80px" />
    </ion-content>
  </ion-page>
</template>

<style scoped lang="scss">
.showcase-section {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing--2xs);
  padding: var(--spacing--2xs) var(--spacing--sm) var(--spacing--sm);
  align-items: center;
}

.spinners {
  gap: var(--spacing--sm);
}

.form-inputs {
  flex-direction: column;
  gap: var(--spacing--sm);

  ion-input, ion-textarea, ion-select {
    width: 100%;
  }
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  padding: 0 var(--spacing--2xs) var(--spacing--2xs);
}

.avatar-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color--primary);
  color: var(--color--neutral-white);
  font-weight: var(--font-weight--bold);
  font-size: var(--font-size--sm);
  border-radius: 50%;
}

.typography {
  flex-direction: column;
  align-items: flex-start;

  h1, h2, h3 {
    margin: var(--spacing--4xs) 0;
    color: var(--color--text--shade-1);
  }

  p {
    margin: var(--spacing--4xs) 0;
    color: var(--color--text);
  }
}

ion-progress-bar {
  margin: var(--spacing--2xs) var(--spacing--sm);
}
</style>
